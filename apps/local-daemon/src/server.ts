import Fastify from "fastify";
import { z } from "zod";
import type {
  AllowedAction,
  ApprovalCommand,
  CleanupJob,
  JobStatus,
  PathKind
} from "@ao/contracts";
import { createId, nowIso } from "@ao/common";
import type {
  ApproveExecuteRequest,
  BootstrapConfigureRequest,
  BootstrapStatusResponse,
  DeviceStatusResponse,
  EnqueueRunRequest,
  OverviewMetricsResponse,
  RuntimeStartResponse,
  RuntimeStatusResponse,
  RuntimeStopResponse,
  RunDetailsResponse
} from "./api-types.js";
import { loadConfig } from "./config.js";
import { ControlApiClient } from "./control-api-client.js";
import { PollWorker } from "./poller.js";
import { RuntimeController } from "./runtime-controller.js";
import { BootstrapConfigStore } from "./services/bootstrap-config-store.js";
import { DeviceCredentialStore } from "./services/device-credential-store.js";
import { createRuntimeServices } from "./services/runtime-services.js";
import { LocalDaemonState } from "./state.js";

const cfg = loadConfig();
const app = Fastify({ logger: true });
const credentialStore = new DeviceCredentialStore(cfg.deviceCredentialTarget);
const bootstrapStore = new BootstrapConfigStore(cfg.bootstrapConfigPath);
const state = new LocalDaemonState({ deviceId: cfg.deviceId, deviceToken: cfg.deviceToken });
const controlApi = new ControlApiClient({
  baseUrl: cfg.controlApiUrl,
  deviceToken: cfg.deviceToken,
  serviceToken: cfg.serviceToken
});
let controlConfigSource: "env" | "bootstrap" | "none" = cfg.serviceToken
  ? "env"
  : "none";
const runtime = createRuntimeServices(cfg);

const poller = new PollWorker(
  cfg,
  state,
  controlApi,
  runtime.store,
  runtime.scanService,
  runtime.planningProvider,
  runtime.executionService,
  runtime.rollbackService,
  console
);
const runtimeController = new RuntimeController(poller, cfg.runtimeStopTimeoutMs);

const pairingStartSchema = z.object({
  label: z.string().min(1).max(120).default("My Windows PC"),
  os: z.enum(["windows", "macos", "linux"]).default("windows")
});

const pairingCompleteSchema = z.object({
  pairingSessionId: z.string()
});

const approvalsSchema: z.ZodType<ApprovalCommand> = z.object({
  runId: z.string(),
  approvals: z.array(
    z.object({
      proposalId: z.string(),
      decision: z.enum(["approve", "reject"]),
      editedAfter: z.record(z.unknown()).optional()
    })
  ),
  decidedBy: z.object({
    actorType: z.literal("local_user"),
    actorId: z.string()
  }),
  decidedAt: z.string()
});

const settingsPatchSchema = z.object({
  dryRunDefault: z.boolean().optional(),
  renamePattern: z.string().min(1).optional(),
  organizedRootPath: z.string().min(1).optional(),
  archiveRootPath: z.string().min(1).optional(),
  duplicateReviewPath: z.string().min(1).optional(),
  recentFileSafetyHours: z.number().int().positive().optional(),
  includeHiddenDefault: z.boolean().optional()
});

const watchedPathCreateSchema = z.object({
  path: z.string().min(1),
  pathType: z.enum(["downloads", "desktop", "screenshots", "custom"]),
  isEnabled: z.boolean().optional(),
  isProtected: z.boolean().optional(),
  includeSubfolders: z.boolean().optional()
});

const watchedPathUpdateSchema = z.object({
  path: z.string().min(1).optional(),
  pathType: z.enum(["downloads", "desktop", "screenshots", "custom"]).optional(),
  isEnabled: z.boolean().optional(),
  isProtected: z.boolean().optional(),
  includeSubfolders: z.boolean().optional()
});

const runStatusEnum = z.enum([
  "queued",
  "claimed",
  "running",
  "awaiting_approval",
  "ready_to_execute",
  "executing",
  "completed",
  "failed",
  "canceled"
]);

const runsQuerySchema = z.object({
  status: runStatusEnum.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});

const enqueueRunSchema: z.ZodType<EnqueueRunRequest> = z.object({
  deviceId: z.string().optional(),
  dryRun: z.boolean(),
  pathKinds: z
    .array(z.enum(["custom", "downloads", "desktop", "screenshots"]))
    .min(1),
  maxFiles: z.number().int().positive().optional(),
  allowedActions: z
    .array(z.enum(["rename", "move", "archive", "index_only", "duplicate_group"]))
    .optional(),
  actorId: z.string().optional()
});

const approveExecuteSchema: z.ZodType<ApproveExecuteRequest> = z.object({
  approvals: z.array(
    z.object({
      proposalId: z.string(),
      decision: z.enum(["approve", "reject"]),
      editedAfter: z.record(z.unknown()).optional()
    })
  ),
  decidedBy: z.object({
    actorId: z.string().min(1)
  }),
  decidedAt: z.string().optional()
});

const bootstrapConfigureSchema: z.ZodType<BootstrapConfigureRequest> = z.object({
  controlApiUrl: z.string().url(),
  serviceToken: z.string().min(8)
});

function parse<T>(
  schema: z.ZodType<T>,
  body: unknown,
  reply: import("fastify").FastifyReply
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    void reply.code(400).send({ error: "invalid_request", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

function renderLocalUi() {
  const device = state.getDevice();
  const snapshots = runtime.store.listRuns();
  const latest = snapshots[0];

  const rows = snapshots
    .map((snapshot) => {
      const s = snapshot.runSummary;
      return `<tr>
        <td>${s.runId}</td>
        <td>${s.status}</td>
        <td>${s.dryRun ? "dry-run" : "live"}</td>
        <td>${s.filesScanned}</td>
        <td>${s.proposalsCreated}</td>
        <td>${s.actionsExecuted}</td>
      </tr>`;
    })
    .join("");

  const proposalCards =
    latest?.proposals
      .map(
        (proposal) => `<div style="border:1px solid #d9e2ef;border-radius:12px;padding:12px;background:#fff;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
            <strong>${proposal.actionType}</strong>
            <span style="font-family:monospace;font-size:12px;color:#536075">${proposal.riskLevel}</span>
          </div>
          <div style="margin-top:6px;color:#0f172a">${proposal.reason}</div>
          <div style="margin-top:6px;font-size:12px;color:#536075">${String(proposal.before.path ?? "")} -> ${String(proposal.after.path ?? "")}</div>
          <div style="margin-top:6px;font-size:12px;color:#536075">status: ${proposal.status ?? "proposed"}</div>
        </div>`
      )
      .join("") ?? `<div style="color:#536075">No proposals yet.</div>`;

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Auto-Organizer Local Daemon</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; background: #f7f8fb; color: #0f172a; }
        .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
        .panel { background:#fff; border:1px solid #d9e2ef; border-radius:16px; padding:16px; box-shadow: 0 10px 30px rgba(16,26,42,.06); }
        .grid { display:grid; grid-template-columns: 1fr; gap:16px; }
        @media (min-width: 960px) { .grid { grid-template-columns: 1.1fr .9fr; } }
        .muted { color:#536075; }
        table { width:100%; border-collapse: collapse; font-size:14px; }
        th,td { text-align:left; padding:8px; border-bottom:1px solid #eef2f7; }
        code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .pill { display:inline-block; border:1px solid #d9e2ef; border-radius:999px; padding:4px 8px; font-size:12px; color:#536075; background:#fff; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="panel" style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center;">
            <div>
              <div class="muted" style="font-family: ui-monospace, monospace; font-size:12px; letter-spacing: .12em; text-transform:uppercase;">local daemon</div>
              <h1 style="margin:8px 0 4px; font-size:28px;">Auto-Organizer (Windows-first local executor)</h1>
              <div class="muted">Approvals and file operations stay local. OpenClaw plans and orchestrates through the control API.</div>
            </div>
            <div>
              <div class="pill">deviceId: ${device.deviceId ?? "unpaired"}</div>
              <div class="pill">heartbeat: ${device.lastHeartbeatAt ?? "not yet"}</div>
            </div>
          </div>
        </div>
        <div class="grid">
          <div class="panel">
            <h2 style="margin-top:0;">Runs</h2>
            <table>
              <thead>
                <tr><th>Run</th><th>Status</th><th>Mode</th><th>Scanned</th><th>Proposals</th><th>Executed</th></tr>
              </thead>
              <tbody>${rows || "<tr><td colspan='6' class='muted'>No runs yet. Pair device and enqueue a job from OpenClaw/control API.</td></tr>"}</tbody>
            </table>
          </div>
          <div class="panel">
            <h2 style="margin-top:0;">Latest Proposals</h2>
            ${proposalCards}
            <div class="muted" style="font-size:12px; margin-top:8px;">
              Use the desktop app for approvals and run execution in this build.
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

function normalizeAllowedActions(input?: AllowedAction[]): AllowedAction[] {
  return input && input.length > 0 ? input : ["rename", "move", "archive", "index_only"];
}

function hasServiceToken() {
  return Boolean(controlApi.getConfig().serviceToken);
}

function currentControlApiUrl() {
  return controlApi.getConfig().baseUrl;
}

function applyControlApiConfig(input: {
  controlApiUrl: string;
  serviceToken?: string;
  source: "env" | "bootstrap" | "none";
}) {
  controlApi.setBaseUrl(input.controlApiUrl);
  controlApi.setServiceToken(input.serviceToken);
  controlConfigSource = input.source;
}

async function mirrorApprovals(command: ApprovalCommand) {
  const serviceToken = controlApi.getConfig().serviceToken;
  if (!serviceToken) return;
  await fetch(`${currentControlApiUrl()}/v1/runs/${command.runId}/approvals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ao-service-token": serviceToken
    },
    body: JSON.stringify(command)
  });
}

async function pushSnapshotToControl(runId: string) {
  const snapshot = runtime.store.getRunSnapshot(runId);
  const device = state.getDevice();
  if (!snapshot || !device.deviceToken) return;
  await controlApi.postJobResult(snapshot.runSummary.jobId, {
    runId: snapshot.runSummary.runId,
    result: snapshot
  });
}

async function hydratePersistedDeviceCredentials() {
  if (cfg.deviceId && cfg.deviceToken) {
    return;
  }
  const persisted = await credentialStore.get();
  if (!persisted) return;
  state.completePairing(persisted.deviceId, persisted.deviceToken);
  controlApi.setDeviceToken(persisted.deviceToken);
  app.log.info(`Loaded persisted device credentials for ${persisted.deviceId}`);
}

async function hydrateBootstrapConfig() {
  const fromFile = await bootstrapStore.load();
  if (!fromFile) return;

  const envHasUrl = Boolean(process.env.AO_CONTROL_API_URL);
  const envHasToken = Boolean(process.env.AO_CONTROL_API_SERVICE_TOKEN);

  applyControlApiConfig({
    controlApiUrl: envHasUrl ? cfg.controlApiUrl : fromFile.controlApiUrl,
    serviceToken: envHasToken ? cfg.serviceToken : fromFile.serviceToken,
    source: envHasToken ? "env" : "bootstrap"
  });

  app.log.info(
    `Loaded bootstrap config for control API (${controlConfigSource}) -> ${currentControlApiUrl()}`
  );
}

function getBootstrapStatus(): BootstrapStatusResponse {
  const current = controlApi.getConfig();
  return {
    configured: Boolean(current.baseUrl && current.serviceToken),
    controlApiUrl: current.baseUrl,
    hasServiceToken: Boolean(current.serviceToken),
    source: controlConfigSource,
    path: bootstrapStore.getPath()
  };
}

app.get("/health", async () => ({ ok: true, service: "ao-local-daemon", at: nowIso() }));

app.get("/", async (_req, reply) => {
  reply.type("text/html");
  return renderLocalUi();
});

app.get("/api/status", async () => ({
  ok: true,
  daemonVersion: cfg.daemonVersion,
  settings: runtime.settingsService.getSettings(),
  runtime: runtimeController.status(),
  bootstrap: getBootstrapStatus(),
  device: state.getDevice(),
  runs: runtime.store.listRuns().length
}));

app.get("/api/runtime/status", async (): Promise<RuntimeStatusResponse> => {
  return runtimeController.status();
});

app.post("/api/runtime/start", async (_req, reply): Promise<RuntimeStartResponse | void> => {
  if (!hasServiceToken()) {
    return reply
      .code(400)
      .send({ error: "missing_service_token", message: "Configure bootstrap first." });
  }
  return runtimeController.startConnection();
});

app.post("/api/runtime/stop", async (): Promise<RuntimeStopResponse> => {
  return runtimeController.stopConnectionGraceful("api_stop");
});

app.post("/api/runtime/shutdown", async () => {
  await runtimeController.stopConnectionGraceful("api_shutdown");
  setTimeout(() => process.exit(0), 100);
  return { ok: true, shuttingDown: true };
});

app.get("/api/bootstrap/status", async (): Promise<BootstrapStatusResponse> => {
  return getBootstrapStatus();
});

app.post("/api/bootstrap/configure", async (req, reply) => {
  const parsed = parse(bootstrapConfigureSchema, req.body, reply);
  if (!parsed) return;

  const saved = await bootstrapStore.save(parsed);
  if (!saved) {
    return reply.code(500).send({
      error: "bootstrap_save_failed",
      message: "Failed to persist bootstrap configuration."
    });
  }

  applyControlApiConfig({
    controlApiUrl: parsed.controlApiUrl,
    serviceToken: parsed.serviceToken,
    source: "bootstrap"
  });

  return {
    ok: true,
    bootstrap: getBootstrapStatus()
  };
});

app.post("/api/bootstrap/reset", async () => {
  await bootstrapStore.clear();

  const envHasUrl = Boolean(process.env.AO_CONTROL_API_URL);
  const envHasToken = Boolean(process.env.AO_CONTROL_API_SERVICE_TOKEN);
  applyControlApiConfig({
    controlApiUrl: envHasUrl ? cfg.controlApiUrl : "http://127.0.0.1:4040",
    serviceToken: envHasToken ? cfg.serviceToken : undefined,
    source: envHasToken ? "env" : "none"
  });

  return {
    ok: true,
    bootstrap: getBootstrapStatus()
  };
});

app.get("/api/device", async (): Promise<DeviceStatusResponse> => {
  const device = state.getDevice();
  return {
    paired: Boolean(device.deviceId && device.deviceToken),
    deviceId: device.deviceId,
    lastHeartbeatAt: device.lastHeartbeatAt
  };
});

app.get("/api/settings", async () => runtime.settingsService.getSettings());

app.put("/api/settings", async (req, reply) => {
  const parsed = parse(settingsPatchSchema, req.body, reply);
  if (!parsed) return;
  const next = runtime.settingsService.updateSettings(parsed);
  return { ok: true, settings: next };
});

app.get("/api/watched-paths", async () => ({
  watchedPaths: runtime.watchedPathsService.list()
}));

app.post("/api/watched-paths", async (req, reply) => {
  const parsed = parse(watchedPathCreateSchema, req.body, reply);
  if (!parsed) return;
  const added = runtime.watchedPathsService.add(parsed);
  return { ok: true, watchedPath: added };
});

app.put("/api/watched-paths/:id", async (req, reply) => {
  const parsed = parse(watchedPathUpdateSchema, req.body, reply);
  if (!parsed) return;
  const { id } = req.params as { id: string };
  const updated = runtime.watchedPathsService.update(id, parsed);
  if (!updated) {
    return reply.code(404).send({ error: "not_found", message: "watched path not found" });
  }
  return { ok: true, watchedPath: updated };
});

app.delete("/api/watched-paths/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const deleted = runtime.watchedPathsService.delete(id);
  if (!deleted) {
    return reply.code(404).send({ error: "not_found", message: "watched path not found" });
  }
  return { ok: true };
});

app.post("/api/watched-paths/validate", async (req, reply) => {
  const body = parse(z.object({ path: z.string().min(1) }), req.body, reply);
  if (!body) return;
  return runtime.watchedPathsService.validatePath(body.path);
});

app.post("/api/pairing/start", async (req, reply) => {
  if (!hasServiceToken()) {
    return reply.code(400).send({ error: "missing_service_token" });
  }
  const parsed = parse(pairingStartSchema, req.body, reply);
  if (!parsed) return;
  const session = await controlApi.startPairing({
    label: parsed.label ?? "My Windows PC",
    os: parsed.os ?? "windows"
  });
  state.setPairingSession(session);
  return session;
});

app.post("/api/pairing/complete", async (req, reply) => {
  const parsed = parse(pairingCompleteSchema, req.body, reply);
  if (!parsed) return;
  const result = await controlApi.completePairing(parsed.pairingSessionId);
  state.completePairing(result.deviceId, result.deviceToken);
  controlApi.setDeviceToken(result.deviceToken);
  await credentialStore.set({
    deviceId: result.deviceId,
    deviceToken: result.deviceToken
  });
  return { ok: true, ...result };
});

app.get("/api/runs", async (req, reply) => {
  const parsed = parse(runsQuerySchema, req.query, reply);
  if (!parsed) return;
  const limit = parsed.limit ?? 50;
  const offset = parsed.offset ?? 0;
  const runs = runtime.store.listRunsPage({
    status: parsed.status as JobStatus | undefined,
    limit,
    offset
  });
  return {
    runs: runs.map((snapshot) => ({
      runSummary: snapshot.runSummary,
      progress: state.getRun(snapshot.runSummary.runId)?.progress ?? []
    })),
    paging: {
      limit,
      offset,
      total: runtime.store.countRuns(parsed.status as JobStatus | undefined)
    }
  };
});

app.get("/api/runs/:runId", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const snapshot = runtime.store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return {
    snapshot,
    progress: state.getRun(runId)?.progress ?? []
  };
});

app.get("/api/runs/:runId/details", async (req, reply): Promise<RunDetailsResponse | void> => {
  const { runId } = req.params as { runId: string };
  const snapshot = runtime.store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return {
    snapshot,
    progress: state.getRun(runId)?.progress ?? [],
    executions: runtime.store.listExecutionsByRun(runId)
  };
});

app.get("/api/runs/:runId/proposals", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const snapshot = runtime.store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return { proposals: snapshot.proposals };
});

app.get("/api/runs/:runId/executions", async (req) => {
  const { runId } = req.params as { runId: string };
  return { executions: runtime.store.listExecutionsByRun(runId) };
});

app.get("/api/metrics/overview", async (): Promise<OverviewMetricsResponse> => {
  const latest = runtime.store.listRunsPage({ limit: 1, offset: 0 })[0]?.runSummary;
  return {
    totals: {
      allRuns: runtime.store.countRuns(),
      awaitingApproval: runtime.store.countRuns("awaiting_approval"),
      completed: runtime.store.countRuns("completed"),
      failed: runtime.store.countRuns("failed")
    },
    latestRun: latest
      ? {
          runId: latest.runId,
          status: latest.status,
          startedAt: latest.startedAt,
          finishedAt: latest.finishedAt,
          filesScanned: latest.filesScanned,
          proposalsCreated: latest.proposalsCreated,
          actionsExecuted: latest.actionsExecuted
        }
      : undefined
  };
});

app.post("/api/runs/enqueue", async (req, reply) => {
  if (!hasServiceToken()) {
    return reply.code(400).send({ error: "missing_service_token" });
  }
  const parsed = parse(enqueueRunSchema, req.body, reply);
  if (!parsed) return;

  const deviceId = parsed.deviceId ?? state.getDevice().deviceId;
  if (!deviceId) {
    return reply.code(400).send({ error: "missing_device_id" });
  }

  const job: CleanupJob = {
    jobId: createId("job"),
    deviceId,
    kind: "cleanup_run",
    triggerType: "manual",
    scope: {
      pathKinds: parsed.pathKinds as PathKind[],
      maxFiles: parsed.maxFiles ?? 500,
      incremental: false
    },
    mode: {
      dryRun: parsed.dryRun,
      allowedActions: normalizeAllowedActions(parsed.allowedActions as AllowedAction[] | undefined)
    },
    requestedBy: {
      actorType: "openclaw",
      actorId: parsed.actorId ?? "local-app"
    },
    createdAt: nowIso()
  };

  const created = await controlApi.enqueueJob(job);
  return {
    ok: true,
    status: created.status,
    runId: created.runId,
    job: created.job
  };
});

app.post("/api/runs/:runId/approvals", async (req, reply) => {
  const parsed = parse(approvalsSchema, req.body, reply);
  if (!parsed) return;
  const run = runtime.store.getRunSnapshot(parsed.runId);
  if (!run) return reply.code(404).send({ error: "not_found", message: "run not found" });
  state.applyApprovals(parsed.runId, parsed);
  runtime.store.applyApprovals(parsed);
  const nextSummary = runtime.store.getRunSummary(parsed.runId);
  if (nextSummary) {
    state.setRunStatus(parsed.runId, nextSummary.status, nextSummary);
  }
  await mirrorApprovals(parsed);
  return { ok: true };
});

app.post("/api/runs/:runId/approve-execute", async (req, reply) => {
  const parsed = parse(approveExecuteSchema, req.body, reply);
  if (!parsed) return;
  const { runId } = req.params as { runId: string };
  const run = runtime.store.getRunSnapshot(runId);
  if (!run) return reply.code(404).send({ error: "not_found", message: "run not found" });

  const approvalCommand: ApprovalCommand = {
    runId,
    approvals: parsed.approvals,
    decidedBy: { actorType: "local_user", actorId: parsed.decidedBy.actorId },
    decidedAt: parsed.decidedAt ?? nowIso()
  };

  state.applyApprovals(runId, approvalCommand);
  runtime.store.applyApprovals(approvalCommand);
  await mirrorApprovals(approvalCommand);

  const refreshed = runtime.store.getRunSnapshot(runId);
  if (!refreshed) return reply.code(404).send({ error: "not_found", message: "run not found" });

  try {
    const result = await runtime.executionService.executeApproved(refreshed);
    state.setRunSnapshot(runId, result.nextSnapshot);
    await pushSnapshotToControl(runId);
    return {
      ok: true,
      runSummary: result.nextSnapshot.runSummary,
      executionRecords: result.executionRecords
    };
  } catch (error) {
    if (String(error).includes("dry_run_execution_blocked")) {
      return reply
        .code(400)
        .send({ error: "dry_run_execution_blocked", message: "Run is dry-run. Execution is blocked." });
    }
    return reply.code(500).send({ error: "execution_failed", message: String(error) });
  }
});

app.post("/api/runs/:runId/execute", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const snapshot = runtime.store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  try {
    const result = await runtime.executionService.executeApproved(snapshot);
    state.setRunSnapshot(runId, result.nextSnapshot);
    await pushSnapshotToControl(runId);
    return { ok: true, runSummary: result.nextSnapshot.runSummary };
  } catch (error) {
    if (String(error).includes("dry_run_execution_blocked")) {
      return reply
        .code(400)
        .send({ error: "dry_run_execution_blocked", message: "Run is dry-run. Execution is blocked." });
    }
    return reply.code(500).send({ error: "execution_failed", message: String(error) });
  }
});

app.post("/api/executions/:executionId/rollback", async (req, reply) => {
  const { executionId } = req.params as { executionId: string };
  const result = await runtime.rollbackService.rollbackExecution(executionId);
  if (!result.ok || !result.runId) {
    return reply.code(404).send({ error: "not_found", message: "execution not found or rollback failed" });
  }
  await pushSnapshotToControl(result.runId);
  return { ok: result.ok, runId: result.runId, proposalId: result.proposalId };
});

app.post("/api/runs/:runId/rollback", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const snapshot = runtime.store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  const next = await runtime.rollbackService.rollbackRun(snapshot);
  state.setRunSnapshot(runId, next);
  await pushSnapshotToControl(runId);
  return { ok: true, runSummary: next.runSummary };
});

async function start() {
  await hydrateBootstrapConfig();
  await hydratePersistedDeviceCredentials();
  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`AO local daemon listening on http://${cfg.host}:${cfg.port}`);
  app.log.info("AO runtime connection is idle. Start via /api/runtime/start.");
}

void start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});

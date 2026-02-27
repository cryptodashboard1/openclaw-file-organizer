import Fastify from "fastify";
import { z } from "zod";
import type {
  ApprovalCommand,
  CleanupJob,
  DeviceHeartbeatRequest,
  ExecuteCommand,
  JobProgressRequest,
  JobResultRequest,
  PairingCompleteRequest,
  PairingStartRequest,
  RollbackCommand
} from "@ao/contracts";
import { createId, nowIso } from "@ao/common";
import { extractBearer, requireServiceToken } from "./auth.js";
import { InMemoryControlStore } from "./store.js";

const app = Fastify({ logger: true });
const store = new InMemoryControlStore();

const CONTROL_API_SERVICE_TOKEN = process.env.AO_CONTROL_API_SERVICE_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 4040);
const HOST = process.env.HOST ?? "0.0.0.0";

const pairingStartSchema = z.object({
  label: z.string().min(1).max(120),
  os: z.enum(["windows", "macos", "linux"])
});

const pairingCompleteSchema = z.object({
  pairingSessionId: z.string().min(1)
});

const cleanupJobSchema: z.ZodType<CleanupJob> = z.object({
  jobId: z.string(),
  deviceId: z.string(),
  kind: z.literal("cleanup_run"),
  triggerType: z.enum(["manual", "scheduled", "watcher_event"]),
  scope: z
    .object({
      pathIds: z.array(z.string()).optional(),
      pathKinds: z.array(z.enum(["downloads", "desktop", "screenshots", "custom"])).optional(),
      maxFiles: z.number().int().positive().optional(),
      incremental: z.boolean().optional()
    })
    .strict(),
  mode: z
    .object({
      dryRun: z.boolean(),
      allowedActions: z.array(
        z.enum(["rename", "move", "archive", "duplicate_group", "index_only"])
      )
    })
    .strict(),
  requestedBy: z
    .object({
      actorType: z.enum(["user", "openclaw"]),
      actorId: z.string()
    })
    .strict(),
  createdAt: z.string()
});

const heartbeatSchema: z.ZodType<DeviceHeartbeatRequest> = z.object({
  deviceId: z.string(),
  daemonVersion: z.string(),
  hostname: z.string().optional(),
  capabilities: z.array(z.string()),
  localUiPort: z.number().int().positive().optional()
});

const jobProgressSchema: z.ZodType<JobProgressRequest> = z.object({
  runId: z.string(),
  status: z.enum([
    "queued",
    "claimed",
    "running",
    "awaiting_approval",
    "ready_to_execute",
    "executing",
    "completed",
    "failed",
    "canceled"
  ]),
  progress: z.object({
    at: z.string(),
    stage: z.enum([
      "scan_started",
      "scan_completed",
      "classification_completed",
      "proposal_generation_completed",
      "awaiting_approval",
      "execution_started",
      "execution_completed",
      "report_generated"
    ]),
    message: z.string(),
    data: z.record(z.unknown()).optional()
  })
});

const jobResultSchema: z.ZodType<JobResultRequest> = z.object({
  runId: z.string(),
  result: z.object({
    runSummary: z.object({
      runId: z.string(),
      deviceId: z.string(),
      jobId: z.string(),
      status: z.enum([
        "queued",
        "claimed",
        "running",
        "awaiting_approval",
        "ready_to_execute",
        "executing",
        "completed",
        "failed",
        "canceled"
      ]),
      dryRun: z.boolean(),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      filesScanned: z.number(),
      proposalsCreated: z.number(),
      actionsExecuted: z.number(),
      duplicatesFound: z.number(),
      bytesRecoveredEstimate: z.number(),
      skippedForSafety: z.number(),
      errorMessage: z.string().optional()
    }),
    proposals: z.array(
      z.object({
        proposalId: z.string(),
        fileId: z.string(),
        actionType: z.enum([
          "rename",
          "move",
          "archive",
          "duplicate_group",
          "index_only",
          "manual_review"
        ]),
        reason: z.string(),
        before: z.record(z.unknown()),
        after: z.record(z.unknown()),
        riskLevel: z.enum(["low", "medium", "high"]),
        approvalRequired: z.boolean(),
        confidence: z.number().optional(),
        rollbackPlan: z.record(z.unknown()),
        status: z.enum(["proposed", "approved", "rejected", "executed", "failed"]).optional()
      })
    )
  })
});

const approvalCommandSchema: z.ZodType<ApprovalCommand> = z.object({
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

const executeCommandSchema: z.ZodType<ExecuteCommand> = z.object({
  runId: z.string(),
  executeApproved: z.boolean(),
  requestedAt: z.string()
});

const rollbackCommandSchema: z.ZodType<RollbackCommand> = z.object({
  runId: z.string(),
  executionIds: z.array(z.string()).optional(),
  requestedAt: z.string()
});

function parseOrReply<T>(
  reply: import("fastify").FastifyReply,
  schema: z.ZodType<T>,
  body: unknown
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    void reply.code(400).send({
      error: "invalid_request",
      message: "request body validation failed",
      details: result.error.flatten()
    });
    return null;
  }
  return result.data;
}

app.get("/health", async () => ({ ok: true, service: "ao-control-api", at: nowIso() }));

app.post("/v1/pairing/start", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const parsed = parseOrReply(reply, pairingStartSchema as z.ZodType<PairingStartRequest>, req.body);
  if (!parsed) return;
  return store.startPairing(parsed.label, parsed.os);
});

app.post("/v1/pairing/complete", async (req, reply) => {
  const parsed = parseOrReply(
    reply,
    pairingCompleteSchema as z.ZodType<PairingCompleteRequest>,
    req.body
  );
  if (!parsed) return;
  const paired = store.completePairing(parsed.pairingSessionId);
  if (!paired) {
    return reply.code(404).send({ error: "not_found", message: "pairing session not found or not approved" });
  }
  return paired;
});

app.get("/v1/devices", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  return { devices: store.listDevices() };
});

app.get("/v1/devices/:deviceId/status", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const { deviceId } = req.params as { deviceId: string };
  const device = store.getDevice(deviceId);
  if (!device) return reply.code(404).send({ error: "not_found", message: "device not found" });
  return { device };
});

app.post("/v1/jobs", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const parsed = parseOrReply(reply, cleanupJobSchema, req.body);
  if (!parsed) return;
  const created = store.enqueueJob(parsed);
  return { job: created.job, runId: created.runId, status: "queued" };
});

app.get("/v1/jobs/:jobId", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const { jobId } = req.params as { jobId: string };
  const job = store.getJob(jobId);
  if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
  return job;
});

app.post("/v1/device/heartbeat", async (req, reply) => {
  const token = extractBearer(req);
  const authedDeviceId = store.resolveDeviceByToken(token);
  if (!authedDeviceId) {
    return reply.code(401).send({ error: "unauthorized", message: "invalid device token" });
  }
  const parsed = parseOrReply(reply, heartbeatSchema, req.body);
  if (!parsed) return;
  if (parsed.deviceId !== authedDeviceId) {
    return reply.code(403).send({ error: "forbidden", message: "device id does not match token" });
  }
  const device = store.heartbeat(parsed.deviceId, { localUiPort: parsed.localUiPort });
  if (!device) return reply.code(404).send({ error: "not_found", message: "device not found" });
  return { ok: true, serverTime: nowIso(), pollAfterMs: 3000, device };
});

app.get("/v1/device/jobs/next", async (req, reply) => {
  const token = extractBearer(req);
  const deviceId = store.resolveDeviceByToken(token);
  if (!deviceId) {
    return reply.code(401).send({ error: "unauthorized", message: "invalid device token" });
  }
  const job = store.claimNextJob(deviceId);
  const runId = job ? store.getJob(job.jobId)?.runId : undefined;
  return { job, runId };
});

app.post("/v1/device/jobs/:jobId/ack", async (req, reply) => {
  const token = extractBearer(req);
  const deviceId = store.resolveDeviceByToken(token);
  if (!deviceId) {
    return reply.code(401).send({ error: "unauthorized", message: "invalid device token" });
  }
  const { jobId } = req.params as { jobId: string };
  const ok = store.ackJob(jobId);
  if (!ok) return reply.code(404).send({ error: "not_found", message: "job not found" });
  return { ok: true };
});

app.post("/v1/device/jobs/:jobId/progress", async (req, reply) => {
  const token = extractBearer(req);
  const deviceId = store.resolveDeviceByToken(token);
  if (!deviceId) {
    return reply.code(401).send({ error: "unauthorized", message: "invalid device token" });
  }
  const { jobId } = req.params as { jobId: string };
  const job = store.getJob(jobId);
  if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
  if (job.job.deviceId !== deviceId) {
    return reply.code(403).send({ error: "forbidden", message: "job does not belong to this device" });
  }
  const parsed = parseOrReply(reply, jobProgressSchema, req.body);
  if (!parsed) return;
  const ok = store.appendProgress(parsed.runId, parsed.status, parsed.progress);
  if (!ok) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return { ok: true };
});

app.post("/v1/device/jobs/:jobId/result", async (req, reply) => {
  const token = extractBearer(req);
  const deviceId = store.resolveDeviceByToken(token);
  if (!deviceId) {
    return reply.code(401).send({ error: "unauthorized", message: "invalid device token" });
  }
  const { jobId } = req.params as { jobId: string };
  const job = store.getJob(jobId);
  if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
  if (job.job.deviceId !== deviceId) {
    return reply.code(403).send({ error: "forbidden", message: "job does not belong to this device" });
  }
  const parsed = parseOrReply(reply, jobResultSchema, req.body);
  if (!parsed) return;
  const ok = store.putResult(parsed.runId, parsed.result);
  if (!ok) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return { ok: true };
});

app.get("/v1/runs/:runId", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const { runId } = req.params as { runId: string };
  const snapshot = store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return { snapshot, progress: store.getRunProgress(runId) };
});

app.get("/v1/runs/:runId/summary", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const { runId } = req.params as { runId: string };
  const summary = store.getRunSummary(runId);
  if (!summary) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return { summary };
});

app.get("/v1/runs/:runId/proposals", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const { runId } = req.params as { runId: string };
  const snapshot = store.getRunSnapshot(runId);
  if (!snapshot) return reply.code(404).send({ error: "not_found", message: "run not found" });
  return { proposals: snapshot.proposals };
});

app.post("/v1/runs/:runId/approvals", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const parsed = parseOrReply(reply, approvalCommandSchema, req.body);
  if (!parsed) return;
  store.setApprovals(parsed);
  return { ok: true };
});

app.post("/v1/runs/:runId/execute", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const parsed = parseOrReply(reply, executeCommandSchema, req.body);
  if (!parsed) return;
  store.setExecuteCommand(parsed);
  return { ok: true };
});

app.post("/v1/runs/:runId/rollback", async (req, reply) => {
  if (!requireServiceToken(req, reply, CONTROL_API_SERVICE_TOKEN)) return;
  const parsed = parseOrReply(reply, rollbackCommandSchema, req.body);
  if (!parsed) return;
  store.setRollbackCommand(parsed);
  return { ok: true };
});

app.get("/v1/runs/:runId/commands", async (req, reply) => {
  const token = extractBearer(req);
  const deviceId = store.resolveDeviceByToken(token);
  if (!deviceId) {
    return reply.code(401).send({ error: "unauthorized", message: "invalid device token" });
  }
  const { runId } = req.params as { runId: string };
  const summary = store.getRunSummary(runId);
  if (!summary) return reply.code(404).send({ error: "not_found", message: "run not found" });
  if (summary.deviceId !== deviceId) {
    return reply.code(403).send({ error: "forbidden", message: "run does not belong to this device" });
  }
  return {
    approvals: store.getApprovals(runId),
    execute: store.getExecuteCommand(runId),
    rollback: store.getRollbackCommand(runId)
  };
});

app.listen({ port: PORT, host: HOST }).then(() => {
  app.log.info(`AO control API listening on http://${HOST}:${PORT}`);
  app.log.info(
    `service token auth ${CONTROL_API_SERVICE_TOKEN ? "enabled" : "disabled (dev mode)"}`
  );
});

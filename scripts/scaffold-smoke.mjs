import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONTROL_API_URL = process.env.AO_CONTROL_API_URL ?? "http://127.0.0.1:4040";
const DAEMON_API_URL = process.env.AO_DAEMON_API_URL ?? "http://127.0.0.1:5050";
const SERVICE_TOKEN = process.env.AO_CONTROL_API_SERVICE_TOKEN ?? "";

function log(step, message, extra) {
  const prefix = `[scaffold-smoke] ${step}`;
  if (extra === undefined) {
    console.log(`${prefix}: ${message}`);
    return;
  }
  console.log(`${prefix}: ${message}`, extra);
}

async function requestJson(baseUrl, path, init = {}, { serviceAuth = false } = {}) {
  const headers = new Headers(init.headers ?? {});
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody) {
    headers.set("content-type", "application/json");
  }
  if (serviceAuth && SERVICE_TOKEN) {
    headers.set("x-ao-service-token", SERVICE_TOKEN);
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${path}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function pollUntil(fn, { timeoutMs = 30000, intervalMs = 1000, label = "condition" } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last?.ok) return last.value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  log("preflight", "checking services");
  await requestJson(CONTROL_API_URL, "/health");
  await requestJson(DAEMON_API_URL, "/health");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ao-smoke-"));
  const inboxPath = path.join(tempRoot, "Inbox");
  const organizedRootPath = path.join(tempRoot, "Organized");
  const archiveRootPath = path.join(organizedRootPath, "Archives");
  const duplicateReviewPath = path.join(organizedRootPath, "Duplicate Review");
  await fs.mkdir(inboxPath, { recursive: true });

  await fs.writeFile(path.join(inboxPath, "document (4).pdf"), "sample invoice");
  await fs.writeFile(path.join(inboxPath, "Screenshot 2026-02-26.png"), "png-bytes");
  await fs.writeFile(path.join(inboxPath, "chrome_installer(2).exe"), "exe-bytes");
  log("setup", "created isolated smoke-test files", { tempRoot });

  log("pairing", "starting pairing via local daemon");
  const started = await requestJson(
    DAEMON_API_URL,
    "/api/pairing/start",
    {
      method: "POST",
      body: JSON.stringify({ label: "Auto-Organizer Smoke Device", os: "windows" })
    }
  );

  const completed = await requestJson(
    DAEMON_API_URL,
    "/api/pairing/complete",
    {
      method: "POST",
      body: JSON.stringify({ pairingSessionId: started.pairingSessionId })
    }
  );
  log("pairing", "paired device", { deviceId: completed.deviceId });

  await requestJson(DAEMON_API_URL, "/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      organizedRootPath,
      archiveRootPath,
      duplicateReviewPath,
      dryRunDefault: false
    })
  });

  await requestJson(DAEMON_API_URL, "/api/watched-paths", {
    method: "POST",
    body: JSON.stringify({
      path: inboxPath,
      pathType: "custom",
      isEnabled: true,
      isProtected: false,
      includeSubfolders: false
    })
  });

  const jobId = `job_smoke_${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const enqueue = await requestJson(
    CONTROL_API_URL,
    "/v1/jobs",
    {
      method: "POST",
      body: JSON.stringify({
        jobId,
        deviceId: completed.deviceId,
        kind: "cleanup_run",
        triggerType: "manual",
        scope: { pathKinds: ["custom"], maxFiles: 200, incremental: false },
        mode: {
          dryRun: false,
          allowedActions: ["rename", "move", "archive", "index_only"]
        },
        requestedBy: { actorType: "openclaw", actorId: "scaffold-smoke" },
        createdAt
      })
    },
    { serviceAuth: true }
  );
  const runId = enqueue.runId;
  log("enqueue", "job queued", { jobId, runId });

  const awaitingApproval = await pollUntil(
    async () => {
      const run = await requestJson(CONTROL_API_URL, `/v1/runs/${runId}`, {}, { serviceAuth: true });
      const status = run?.snapshot?.runSummary?.status;
      if (status === "awaiting_approval") {
        return { ok: true, value: run };
      }
      return { ok: false, value: run };
    },
    { timeoutMs: 45000, intervalMs: 1500, label: "run awaiting approval" }
  );
  log("run", "awaiting approval", {
    status: awaitingApproval.snapshot.runSummary.status,
    proposals: awaitingApproval.snapshot.proposals.length
  });

  if ((awaitingApproval.snapshot.proposals?.length ?? 0) === 0) {
    throw new Error("expected proposals but got 0");
  }

  const proposals = awaitingApproval.snapshot.proposals ?? [];
  const approvals = proposals.map((p) => ({
    proposalId: p.proposalId,
    decision: p.actionType === "manual_review" ? "reject" : "approve"
  }));

  await requestJson(
    DAEMON_API_URL,
    `/api/runs/${runId}/approvals`,
    {
      method: "POST",
      body: JSON.stringify({
        runId,
        approvals,
        decidedBy: { actorType: "local_user", actorId: "smoke-script" },
        decidedAt: new Date().toISOString()
      })
    }
  );
  log("approvals", "applied local approvals", {
    approved: approvals.filter((a) => a.decision === "approve").length,
    rejected: approvals.filter((a) => a.decision === "reject").length
  });

  await requestJson(
    DAEMON_API_URL,
    `/api/runs/${runId}/execute`,
    { method: "POST" }
  );
  log("execute", "triggered local execute");

  const completedRun = await pollUntil(
    async () => {
      const run = await requestJson(CONTROL_API_URL, `/v1/runs/${runId}`, {}, { serviceAuth: true });
      const status = run?.snapshot?.runSummary?.status;
      if (status === "completed") {
        return { ok: true, value: run };
      }
      return { ok: false, value: run };
    },
    { timeoutMs: 20000, intervalMs: 1000, label: "run completed" }
  );
  log("run", "completed", completedRun.snapshot.runSummary);

  if ((completedRun.snapshot.runSummary.actionsExecuted ?? 0) < 1) {
    throw new Error("expected at least one executed action");
  }

  await requestJson(
    DAEMON_API_URL,
    `/api/runs/${runId}/rollback`,
    { method: "POST" }
  );
  log("rollback", "triggered scaffold rollback");

  const finalSummary = await requestJson(
    CONTROL_API_URL,
    `/v1/runs/${runId}/summary`,
    {},
    { serviceAuth: true }
  );

  log("done", "final summary", finalSummary.summary);
  if ((finalSummary.summary.actionsExecuted ?? -1) !== 0) {
    throw new Error("expected actionsExecuted to be 0 after rollback");
  }

  await fs.rm(tempRoot, { recursive: true, force: true });
  console.log("\nScaffold smoke test completed successfully.");
}

main().catch((err) => {
  console.error("\nScaffold smoke test failed.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

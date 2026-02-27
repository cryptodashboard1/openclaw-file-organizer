import type { CleanupJob } from "@ao/contracts";
import { createId, nowIso } from "@ao/common";
import { AoControlClient } from "./control-api-client.js";

export type AoToolContext = {
  controlApi: AoControlClient;
};

export async function ao_list_devices(ctx: AoToolContext) {
  return ctx.controlApi.listDevices();
}

export async function ao_get_device_status(ctx: AoToolContext, input: { deviceId: string }) {
  return ctx.controlApi.getDeviceStatus(input.deviceId);
}

export async function ao_enqueue_cleanup_job(
  ctx: AoToolContext,
  input: {
    deviceId: string;
    dryRun?: boolean;
    pathKinds?: Array<"downloads" | "desktop" | "screenshots" | "custom">;
    maxFiles?: number;
    allowedActions?: Array<"rename" | "move" | "archive" | "duplicate_group" | "index_only">;
    actorId?: string;
  }
) {
  const job: CleanupJob = {
    jobId: createId("job"),
    deviceId: input.deviceId,
    kind: "cleanup_run",
    triggerType: "manual",
    scope: {
      pathKinds: input.pathKinds ?? ["downloads"],
      maxFiles: input.maxFiles ?? 500,
      incremental: false
    },
    mode: {
      dryRun: input.dryRun ?? true,
      allowedActions: input.allowedActions ?? ["rename", "move", "archive", "index_only"]
    },
    requestedBy: {
      actorType: "openclaw",
      actorId: input.actorId ?? "openclaw"
    },
    createdAt: nowIso()
  };
  return ctx.controlApi.enqueueCleanupJob(job);
}

export async function ao_get_run_summary(ctx: AoToolContext, input: { runId: string }) {
  return ctx.controlApi.getRunSummary(input.runId);
}

export async function ao_list_run_proposals(ctx: AoToolContext, input: { runId: string }) {
  return ctx.controlApi.listRunProposals(input.runId);
}

export async function ao_get_run_status(ctx: AoToolContext, input: { runId: string }) {
  return ctx.controlApi.getRun(input.runId);
}

export async function ao_submit_approvals(
  ctx: AoToolContext,
  input: {
    runId: string;
    approvals: ApprovalInput[];
    actorId?: string;
  }
) {
  return ctx.controlApi.submitApprovals(input.runId, {
    runId: input.runId,
    approvals: input.approvals,
    decidedBy: {
      actorType: "local_user",
      actorId: input.actorId ?? "openclaw-remote-approval"
    },
    decidedAt: nowIso()
  });
}

export async function ao_request_execute(ctx: AoToolContext, input: { runId: string }) {
  return ctx.controlApi.requestExecute(input.runId);
}

export async function ao_request_rollback(
  ctx: AoToolContext,
  input: { runId: string; executionIds?: string[] }
) {
  return ctx.controlApi.requestRollback(input.runId, input.executionIds);
}

export async function ao_get_weekly_report(
  _ctx: AoToolContext,
  input: { deviceId: string; range?: "last_7_days" | "this_week" }
) {
  return {
    ok: false,
    code: "not_implemented",
    message:
      "Weekly report endpoint is not implemented in the scaffold yet. Use ao_get_run_summary for current runs.",
    deviceId: input.deviceId,
    range: input.range ?? "last_7_days"
  };
}

export const AO_TOOL_CATALOG = {
  ao_list_devices,
  ao_get_device_status,
  ao_enqueue_cleanup_job,
  ao_get_run_summary,
  ao_list_run_proposals,
  ao_get_run_status,
  ao_submit_approvals,
  ao_request_execute,
  ao_request_rollback,
  ao_get_weekly_report
};

type ApprovalInput = {
  proposalId: string;
  decision: "approve" | "reject";
  editedAfter?: Record<string, unknown>;
};

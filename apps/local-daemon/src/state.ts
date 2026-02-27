import type {
  ApprovalCommand,
  CleanupJob,
  JobStatus,
  ProposalResult,
  RunSnapshot,
  RunSummary
} from "@ao/contracts";
import { createId, nowIso } from "@ao/common";

export type LocalDaemonDeviceState = {
  deviceId?: string;
  deviceToken?: string;
  pairing?: {
    pairingSessionId: string;
    pairingCode: string;
    expiresAt: string;
  };
};

export type LocalRunRecord = {
  job: CleanupJob;
  snapshot: RunSnapshot;
  progress: Array<{ at: string; stage: string; message: string; data?: Record<string, unknown> }>;
};

export class LocalDaemonState {
  private device: LocalDaemonDeviceState = {};
  private runs = new Map<string, LocalRunRecord>();
  private runByJobId = new Map<string, string>();
  private lastHeartbeatAt?: string;

  constructor(seed?: { deviceId?: string; deviceToken?: string }) {
    this.device.deviceId = seed?.deviceId;
    this.device.deviceToken = seed?.deviceToken;
  }

  getDevice() {
    return { ...this.device, lastHeartbeatAt: this.lastHeartbeatAt };
  }

  setPairingSession(pairing: LocalDaemonDeviceState["pairing"]) {
    this.device.pairing = pairing;
  }

  completePairing(deviceId: string, deviceToken: string) {
    this.device.deviceId = deviceId;
    this.device.deviceToken = deviceToken;
    this.device.pairing = undefined;
  }

  markHeartbeat() {
    this.lastHeartbeatAt = nowIso();
  }

  getLastHeartbeatAt() {
    return this.lastHeartbeatAt;
  }

  createRunFromJob(job: CleanupJob, forcedRunId?: string): LocalRunRecord {
    const runId = forcedRunId ?? createId("run");
    const summary: RunSummary = {
      runId,
      deviceId: job.deviceId,
      jobId: job.jobId,
      status: "running",
      dryRun: job.mode.dryRun,
      startedAt: nowIso(),
      filesScanned: 0,
      proposalsCreated: 0,
      actionsExecuted: 0,
      duplicatesFound: 0,
      bytesRecoveredEstimate: 0,
      skippedForSafety: 0
    };
    const snapshot: RunSnapshot = { runSummary: summary, proposals: [] };
    const record: LocalRunRecord = { job, snapshot, progress: [] };
    this.runs.set(runId, record);
    this.runByJobId.set(job.jobId, runId);
    return record;
  }

  getRun(runId: string): LocalRunRecord | null {
    return this.runs.get(runId) ?? null;
  }

  getRunByJobId(jobId: string): LocalRunRecord | null {
    const runId = this.runByJobId.get(jobId);
    if (!runId) return null;
    return this.runs.get(runId) ?? null;
  }

  listRuns(): LocalRunRecord[] {
    return [...this.runs.values()].sort((a, b) =>
      b.snapshot.runSummary.startedAt.localeCompare(a.snapshot.runSummary.startedAt)
    );
  }

  appendProgress(runId: string, stage: string, message: string, data?: Record<string, unknown>) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.progress.push({ at: nowIso(), stage, message, data });
  }

  setRunStatus(runId: string, status: JobStatus, patch?: Partial<RunSummary>) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.snapshot.runSummary = {
      ...run.snapshot.runSummary,
      ...patch,
      status
    };
  }

  seedProposals(
    runId: string,
    proposals: ProposalResult[],
    stats?: { filesScanned?: number; skippedForSafety?: number }
  ) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.snapshot.proposals = proposals;
    run.snapshot.runSummary.proposalsCreated = proposals.length;
    run.snapshot.runSummary.filesScanned = stats?.filesScanned ?? 0;
    run.snapshot.runSummary.skippedForSafety = stats?.skippedForSafety ?? 0;
    run.snapshot.runSummary.status = "awaiting_approval";
  }

  setRunSnapshot(runId: string, snapshot: RunSnapshot) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.snapshot = snapshot;
  }

  applyApprovals(runId: string, approvals: ApprovalCommand) {
    const run = this.runs.get(runId);
    if (!run) return;
    const decisions = new Map(approvals.approvals.map((a) => [a.proposalId, a]));
    run.snapshot.proposals = run.snapshot.proposals.map((proposal) => {
      const decision = decisions.get(proposal.proposalId);
      if (!decision) return proposal;
      return {
        ...proposal,
        after: decision.editedAfter ?? proposal.after,
        status: decision.decision === "approve" ? "approved" : "rejected"
      };
    });
    run.snapshot.runSummary.status = "ready_to_execute";
  }

  executeApproved(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    let executed = 0;
    run.snapshot.proposals = run.snapshot.proposals.map((proposal) => {
      if (proposal.status === "approved") {
        executed += 1;
        return { ...proposal, status: "executed" };
      }
      return proposal;
    });
    run.snapshot.runSummary.actionsExecuted = executed;
    run.snapshot.runSummary.bytesRecoveredEstimate = 1_288_490_188;
    run.snapshot.runSummary.status = "completed";
    run.snapshot.runSummary.finishedAt = nowIso();
  }

  rollbackRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.snapshot.runSummary.status = "completed";
    run.progress.push({
      at: nowIso(),
      stage: "rollback_completed",
      message: "Rollback completed for selected actions"
    });
    run.snapshot.proposals = run.snapshot.proposals.map((proposal) =>
      proposal.status === "executed" ? { ...proposal, status: "approved" } : proposal
    );
    run.snapshot.runSummary.actionsExecuted = 0;
  }
}

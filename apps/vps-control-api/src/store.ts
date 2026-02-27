import type {
  ApprovalCommand,
  CleanupJob,
  DeviceRecord,
  ExecuteCommand,
  JobProgressEvent,
  JobStatus,
  PairingStartResponse,
  RollbackCommand,
  RunSnapshot,
  RunSummary
} from "@ao/contracts";
import type { DeviceToken } from "./types.js";
import { createId, createShortCode, minutesFromNowIso, nowIso } from "@ao/common";

type PairingSession = PairingStartResponse & {
  label: string;
  os: DeviceRecord["os"];
  approved: boolean;
  completed: boolean;
};

export class InMemoryControlStore {
  private pairingSessions = new Map<string, PairingSession>();
  private devices = new Map<string, DeviceRecord>();
  private deviceTokens = new Map<string, string>(); // token -> deviceId
  private jobs = new Map<string, CleanupJob>();
  private jobStatus = new Map<string, JobStatus>();
  private jobByDevice = new Map<string, string[]>();
  private jobRunId = new Map<string, string>();
  private runSummaries = new Map<string, RunSummary>();
  private runSnapshots = new Map<string, RunSnapshot>();
  private runProgress = new Map<string, JobProgressEvent[]>();
  private approvalCommands = new Map<string, ApprovalCommand>();
  private executeCommands = new Map<string, ExecuteCommand>();
  private rollbackCommands = new Map<string, RollbackCommand>();

  startPairing(label: string, os: DeviceRecord["os"]): PairingStartResponse {
    const pairingSessionId = createId("pair");
    const session: PairingSession = {
      pairingSessionId,
      pairingCode: createShortCode(6),
      expiresAt: minutesFromNowIso(10),
      label,
      os,
      approved: true, // v1 skeleton: auto-approve
      completed: false
    };
    this.pairingSessions.set(pairingSessionId, session);
    return {
      pairingSessionId: session.pairingSessionId,
      pairingCode: session.pairingCode,
      expiresAt: session.expiresAt
    };
  }

  completePairing(pairingSessionId: string): { deviceId: string; deviceToken: string; pairedAt: string } | null {
    const session = this.pairingSessions.get(pairingSessionId);
    if (!session || session.completed || !session.approved) {
      return null;
    }
    const deviceId = createId("dev");
    const deviceToken = createId("dtok");
    const pairedAt = nowIso();

    const record: DeviceRecord = {
      deviceId,
      label: session.label,
      os: session.os,
      status: "offline",
      pairedAt
    };

    this.devices.set(deviceId, record);
    this.deviceTokens.set(deviceToken, deviceId);
    this.jobByDevice.set(deviceId, []);
    session.completed = true;
    return { deviceId, deviceToken, pairedAt };
  }

  resolveDeviceByToken(token: string | undefined): string | null {
    if (!token) return null;
    return this.deviceTokens.get(token) ?? null;
  }

  heartbeat(deviceId: string, patch: { localUiPort?: number }): DeviceRecord | null {
    const record = this.devices.get(deviceId);
    if (!record) return null;
    const next: DeviceRecord = {
      ...record,
      status: "online",
      lastHeartbeatAt: nowIso()
    };
    this.devices.set(deviceId, next);
    return next;
  }

  listDevices(): DeviceRecord[] {
    return [...this.devices.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  getDevice(deviceId: string): DeviceRecord | null {
    return this.devices.get(deviceId) ?? null;
  }

  enqueueJob(job: CleanupJob): { job: CleanupJob; runId: string } {
    this.jobs.set(job.jobId, job);
    this.jobStatus.set(job.jobId, "queued");
    const queue = this.jobByDevice.get(job.deviceId) ?? [];
    queue.push(job.jobId);
    this.jobByDevice.set(job.deviceId, queue);

    const runId = createId("run");
    this.jobRunId.set(job.jobId, runId);
    const runSummary: RunSummary = {
      runId,
      deviceId: job.deviceId,
      jobId: job.jobId,
      status: "queued",
      dryRun: job.mode.dryRun,
      startedAt: nowIso(),
      filesScanned: 0,
      proposalsCreated: 0,
      actionsExecuted: 0,
      duplicatesFound: 0,
      bytesRecoveredEstimate: 0,
      skippedForSafety: 0
    };
    this.runSummaries.set(runId, runSummary);
    this.runSnapshots.set(runId, { runSummary, proposals: [] });

    return { job, runId };
  }

  getJob(jobId: string): { job: CleanupJob; status: JobStatus; runId?: string } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { job, status: this.jobStatus.get(jobId) ?? "queued", runId: this.jobRunId.get(jobId) };
  }

  claimNextJob(deviceId: string): CleanupJob | null {
    const queue = this.jobByDevice.get(deviceId) ?? [];
    for (const jobId of queue) {
      const status = this.jobStatus.get(jobId);
      if (status === "queued") {
        this.jobStatus.set(jobId, "claimed");
        const runId = this.jobRunId.get(jobId);
        if (runId) {
          this.patchRunSummary(runId, { status: "claimed" });
        }
        return this.jobs.get(jobId) ?? null;
      }
    }
    return null;
  }

  ackJob(jobId: string): boolean {
    if (!this.jobs.has(jobId)) return false;
    this.jobStatus.set(jobId, "running");
    const runId = this.jobRunId.get(jobId);
    if (runId) {
      this.patchRunSummary(runId, { status: "running" });
    }
    return true;
  }

  appendProgress(runId: string, status: JobStatus, progress: JobProgressEvent): boolean {
    if (!this.runSummaries.has(runId)) return false;
    const list = this.runProgress.get(runId) ?? [];
    list.push(progress);
    this.runProgress.set(runId, list);
    this.patchRunSummary(runId, { status });
    return true;
  }

  putResult(runId: string, snapshot: RunSnapshot): boolean {
    if (!this.runSummaries.has(runId)) return false;
    this.runSnapshots.set(runId, snapshot);
    this.runSummaries.set(runId, snapshot.runSummary);
    this.jobStatus.set(snapshot.runSummary.jobId, snapshot.runSummary.status);
    return true;
  }

  getRunSummary(runId: string): RunSummary | null {
    return this.runSummaries.get(runId) ?? null;
  }

  getRunSnapshot(runId: string): RunSnapshot | null {
    return this.runSnapshots.get(runId) ?? null;
  }

  getRunProgress(runId: string): JobProgressEvent[] {
    return this.runProgress.get(runId) ?? [];
  }

  setApprovals(command: ApprovalCommand): void {
    this.approvalCommands.set(command.runId, command);
    const snapshot = this.runSnapshots.get(command.runId);
    if (snapshot) {
      const proposalMap = new Map(command.approvals.map((a) => [a.proposalId, a.decision]));
      snapshot.proposals = snapshot.proposals.map((p) =>
        proposalMap.has(p.proposalId)
          ? {
              ...p,
              status: proposalMap.get(p.proposalId) === "approve" ? "approved" : "rejected"
            }
          : p
      );
      snapshot.runSummary.status = "ready_to_execute";
      this.runSnapshots.set(command.runId, snapshot);
      this.runSummaries.set(command.runId, snapshot.runSummary);
    }
  }

  getApprovals(runId: string): ApprovalCommand | null {
    return this.approvalCommands.get(runId) ?? null;
  }

  setExecuteCommand(command: ExecuteCommand): void {
    this.executeCommands.set(command.runId, command);
    this.patchRunSummary(command.runId, { status: "ready_to_execute" });
  }

  getExecuteCommand(runId: string): ExecuteCommand | null {
    return this.executeCommands.get(runId) ?? null;
  }

  setRollbackCommand(command: RollbackCommand): void {
    this.rollbackCommands.set(command.runId, command);
  }

  getRollbackCommand(runId: string): RollbackCommand | null {
    return this.rollbackCommands.get(runId) ?? null;
  }

  private patchRunSummary(runId: string, patch: Partial<RunSummary>) {
    const current = this.runSummaries.get(runId);
    if (!current) return;
    const next = { ...current, ...patch };
    this.runSummaries.set(runId, next);
    const snapshot = this.runSnapshots.get(runId);
    if (snapshot) {
      this.runSnapshots.set(runId, { ...snapshot, runSummary: next });
    }
  }
}

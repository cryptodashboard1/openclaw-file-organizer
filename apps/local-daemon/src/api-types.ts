import type {
  AllowedAction,
  ApprovalDecision,
  JobStatus,
  PathKind,
  RunSnapshot
} from "@ao/contracts";
import type { ExecutionRecord } from "./services/types.js";

export type EnqueueRunRequest = {
  deviceId?: string;
  dryRun: boolean;
  pathKinds: PathKind[];
  maxFiles?: number;
  allowedActions?: AllowedAction[];
  actorId?: string;
};

export type ApproveExecuteRequest = {
  approvals: ApprovalDecision[];
  decidedBy: {
    actorId: string;
  };
  decidedAt?: string;
};

export type DeviceStatusResponse = {
  paired: boolean;
  deviceId?: string;
  lastHeartbeatAt?: string;
};

export type RuntimeStatusResponse = {
  state: "disconnected" | "connecting" | "connected" | "stopping";
  poller: {
    running: boolean;
    acceptingJobs: boolean;
    inTick: boolean;
    stage: "idle" | "heartbeat" | "jobs" | "commands";
    activeRunId?: string;
  };
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastError?: string;
};

export type RuntimeStartResponse = {
  ok: boolean;
  status: RuntimeStatusResponse;
  alreadyRunning?: boolean;
  message?: string;
  error?: string;
};

export type RuntimeStopResponse = {
  ok: boolean;
  forced?: boolean;
  reason: string;
  status: RuntimeStatusResponse;
};

export type BootstrapConfigureRequest = {
  controlApiUrl: string;
  serviceToken: string;
};

export type BootstrapStatusResponse = {
  configured: boolean;
  controlApiUrl?: string;
  hasServiceToken: boolean;
  source: "env" | "bootstrap" | "none";
  path: string;
};

export type RunDetailsResponse = {
  snapshot: RunSnapshot;
  progress: Array<{ at: string; stage: string; message: string; data?: Record<string, unknown> }>;
  executions: ExecutionRecord[];
};

export type OverviewMetricsResponse = {
  totals: {
    allRuns: number;
    awaitingApproval: number;
    completed: number;
    failed: number;
  };
  latestRun?: {
    runId: string;
    status: JobStatus;
    startedAt: string;
    finishedAt?: string;
    filesScanned: number;
    proposalsCreated: number;
    actionsExecuted: number;
  };
};

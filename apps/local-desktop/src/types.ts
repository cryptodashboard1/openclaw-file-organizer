export type DaemonStatus = {
  ok: boolean;
  daemonVersion: string;
  settings: LocalSettings;
  device: {
    deviceId?: string;
    deviceToken?: string;
    pairing?: {
      pairingSessionId: string;
      pairingCode: string;
      expiresAt: string;
    };
    lastHeartbeatAt?: string;
  };
  runs: number;
};

export type LocalSettings = {
  dryRunDefault: boolean;
  renamePattern: string;
  organizedRootPath: string;
  archiveRootPath: string;
  duplicateReviewPath: string;
  recentFileSafetyHours: number;
  includeHiddenDefault: boolean;
};

export type WatchedPath = {
  id: string;
  path: string;
  pathType: "downloads" | "desktop" | "screenshots" | "custom";
  isEnabled: boolean;
  isProtected: boolean;
  includeSubfolders: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RunSummary = {
  runId: string;
  deviceId: string;
  jobId: string;
  status:
    | "queued"
    | "claimed"
    | "running"
    | "awaiting_approval"
    | "ready_to_execute"
    | "executing"
    | "completed"
    | "failed"
    | "canceled";
  dryRun: boolean;
  startedAt: string;
  finishedAt?: string;
  filesScanned: number;
  proposalsCreated: number;
  actionsExecuted: number;
  duplicatesFound: number;
  bytesRecoveredEstimate: number;
  skippedForSafety: number;
  errorMessage?: string;
};

export type Proposal = {
  proposalId: string;
  fileId: string;
  actionType: "rename" | "move" | "archive" | "duplicate_group" | "index_only" | "manual_review";
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  confidence?: number;
  rollbackPlan: Record<string, unknown>;
  status?: "proposed" | "approved" | "rejected" | "executed" | "failed";
};

export type RunRecord = {
  runSummary: RunSummary;
  progress: Array<{
    at: string;
    stage: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
};

export type ExecutionRecord = {
  executionId: string;
  proposalId: string;
  runId: string;
  operationType: string;
  success: boolean;
  errorMessage?: string;
  rollbackJson?: string;
  startedAt: string;
  finishedAt?: string;
};

export type RunDetails = {
  snapshot: {
    runSummary: RunSummary;
    proposals: Proposal[];
  };
  progress: Array<{
    at: string;
    stage: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
  executions: ExecutionRecord[];
};

export type MetricsOverview = {
  totals: {
    allRuns: number;
    awaitingApproval: number;
    completed: number;
    failed: number;
  };
  latestRun?: {
    runId: string;
    status: RunSummary["status"];
    startedAt: string;
    finishedAt?: string;
    filesScanned: number;
    proposalsCreated: number;
    actionsExecuted: number;
  };
};

export type RuntimeStatus = {
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

export type BootstrapStatus = {
  configured: boolean;
  controlApiUrl?: string;
  hasServiceToken: boolean;
  source: "env" | "bootstrap" | "none";
  path: string;
};

export type DaemonSidecarStatus = {
  available: boolean;
  running: boolean;
  pid?: number;
  entryPath?: string;
  lastError?: string;
};

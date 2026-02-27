export type ISODateString = string;

export type TriggerType = "manual" | "scheduled" | "watcher_event";
export type CleanupJobKind = "cleanup_run";

export type PathKind = "downloads" | "desktop" | "screenshots" | "custom";
export type AllowedAction = "rename" | "move" | "archive" | "duplicate_group" | "index_only";
export type ProposalActionType =
  | "rename"
  | "move"
  | "archive"
  | "duplicate_group"
  | "index_only"
  | "manual_review";
export type RiskLevel = "low" | "medium" | "high";
export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "awaiting_approval"
  | "ready_to_execute"
  | "executing"
  | "completed"
  | "failed"
  | "canceled";

export type DeviceConnectionState = "online" | "offline" | "stale";

export type CleanupJob = {
  jobId: string;
  deviceId: string;
  kind: CleanupJobKind;
  triggerType: TriggerType;
  scope: {
    pathIds?: string[];
    pathKinds?: PathKind[];
    maxFiles?: number;
    incremental?: boolean;
  };
  mode: {
    dryRun: boolean;
    allowedActions: AllowedAction[];
  };
  requestedBy: {
    actorType: "user" | "openclaw";
    actorId: string;
  };
  createdAt: ISODateString;
};

export type DeviceRecord = {
  deviceId: string;
  label: string;
  os: "windows" | "macos" | "linux";
  status: DeviceConnectionState;
  lastHeartbeatAt?: ISODateString;
  pairedAt: ISODateString;
};

export type DeviceHeartbeatRequest = {
  deviceId: string;
  daemonVersion: string;
  hostname?: string;
  capabilities: string[];
  localUiPort?: number;
};

export type DeviceHeartbeatResponse = {
  ok: true;
  serverTime: ISODateString;
  pollAfterMs: number;
};

export type PairingStartRequest = {
  label: string;
  os: "windows" | "macos" | "linux";
};

export type PairingStartResponse = {
  pairingSessionId: string;
  pairingCode: string;
  expiresAt: ISODateString;
};

export type PairingCompleteRequest = {
  pairingSessionId: string;
};

export type PairingCompleteResponse = {
  deviceId: string;
  deviceToken: string;
  pairedAt: ISODateString;
};

export type FileSignalPayload = {
  fileId: string;
  filename: string;
  extension?: string;
  pathHint: string;
  mimeType?: string;
  sizeBytes: number;
  modifiedAt?: ISODateString;
  extractedTextSnippet?: string;
  imageMeta?: { width: number; height: number };
};

export type ClassificationResult = {
  fileId: string;
  classification: string;
  confidence: number;
  generatedLabel: string;
  rationale: string;
  renameOk: boolean;
  moveOk: boolean;
  manualReview: boolean;
};

export type ProposalResult = {
  proposalId: string;
  fileId: string;
  actionType: ProposalActionType;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  confidence?: number;
  rollbackPlan: Record<string, unknown>;
  status?: "proposed" | "approved" | "rejected" | "executed" | "failed";
};

export type RunSummary = {
  runId: string;
  deviceId: string;
  jobId: string;
  status: JobStatus;
  dryRun: boolean;
  startedAt: ISODateString;
  finishedAt?: ISODateString;
  filesScanned: number;
  proposalsCreated: number;
  actionsExecuted: number;
  duplicatesFound: number;
  bytesRecoveredEstimate: number;
  skippedForSafety: number;
  errorMessage?: string;
};

export type RunSnapshot = {
  runSummary: RunSummary;
  proposals: ProposalResult[];
};

export type JobClaimResponse = {
  job: CleanupJob | null;
  runId?: string;
};

export type JobAckRequest = {
  acknowledgedAt: ISODateString;
};

export type JobProgressEvent = {
  at: ISODateString;
  stage:
    | "scan_started"
    | "scan_completed"
    | "classification_completed"
    | "proposal_generation_completed"
    | "awaiting_approval"
    | "execution_started"
    | "execution_completed"
    | "report_generated";
  message: string;
  data?: Record<string, unknown>;
};

export type JobProgressRequest = {
  runId: string;
  status: JobStatus;
  progress: JobProgressEvent;
};

export type JobResultRequest = {
  runId: string;
  result: RunSnapshot;
};

export type ApprovalDecision = {
  proposalId: string;
  decision: "approve" | "reject";
  editedAfter?: Record<string, unknown>;
};

export type ApprovalCommand = {
  runId: string;
  approvals: ApprovalDecision[];
  decidedBy: { actorType: "local_user"; actorId: string };
  decidedAt: ISODateString;
};

export type ExecuteCommand = {
  runId: string;
  executeApproved: boolean;
  requestedAt: ISODateString;
};

export type RollbackCommand = {
  runId: string;
  executionIds?: string[];
  requestedAt: ISODateString;
};

export type ControlApiError = {
  error: string;
  message: string;
  details?: Record<string, unknown>;
};

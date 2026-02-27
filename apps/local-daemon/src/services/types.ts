import type { CleanupJob, ProposalResult, RunSnapshot } from "@ao/contracts";

export type LocalSettings = {
  dryRunDefault: boolean;
  renamePattern: string;
  organizedRootPath: string;
  archiveRootPath: string;
  duplicateReviewPath: string;
  recentFileSafetyHours: number;
  includeHiddenDefault: boolean;
};

export type WatchedPathRecord = {
  id: string;
  path: string;
  pathType: "downloads" | "desktop" | "screenshots" | "custom";
  isEnabled: boolean;
  isProtected: boolean;
  includeSubfolders: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScanCandidate = {
  fileId: string;
  absolutePath: string;
  parentPath: string;
  filename: string;
  extension: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAtFs: string | null;
  modifiedAtFs: string | null;
  classification?: string;
  confidence?: number;
  generatedLabel?: string;
  rationale?: string;
  manualReview?: boolean;
};

export type PathPolicyDecision = {
  allowed: boolean;
  reason?: string;
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

export type RollbackPlanRecord = {
  type: "move_back" | "rename_back";
  from: string;
  to: string;
};

export type ProposalGenerationContext = {
  runId: string;
  job: CleanupJob;
  candidates: ScanCandidate[];
};

export type PlanningProvider = {
  classifyFiles(candidates: ScanCandidate[]): Promise<ScanCandidate[]>;
  proposeActions(context: ProposalGenerationContext): Promise<ProposalResult[]>;
};

export type RunSnapshotWithProgress = {
  snapshot: RunSnapshot;
  progress: Array<{ at: string; stage: string; message: string; data?: Record<string, unknown> }>;
};

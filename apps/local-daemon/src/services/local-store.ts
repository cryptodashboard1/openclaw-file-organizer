import type {
  ApprovalCommand,
  CleanupJob,
  ProposalResult,
  RunSnapshot,
  RunSummary
} from "@ao/contracts";
import { createId, nowIso } from "@ao/common";
import type Database from "better-sqlite3";
import type {
  ExecutionRecord,
  LocalSettings,
  ScanCandidate,
  WatchedPathRecord
} from "./types.js";

type CleanupRunRow = {
  id: string;
  job_id: string;
  device_id: string;
  trigger_type: string;
  dry_run: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  files_scanned: number;
  proposals_created: number;
  actions_executed: number;
  duplicates_found: number;
  bytes_recovered_estimate: number;
  skipped_for_safety: number;
  summary_json: string | null;
};

type ProposalRow = {
  id: string;
  file_id: string;
  action_type: string;
  reason: string;
  before_json: string;
  after_json: string;
  risk_level: "low" | "medium" | "high";
  confidence: number | null;
  approval_required: number;
  status: "proposed" | "approved" | "rejected" | "executed" | "failed";
  batch_id: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
};

export class LocalStore {
  constructor(private readonly db: Database.Database) {}

  initializeDefaults(input: {
    organizedRootPath?: string;
    recentFileSafetyHours: number;
    includeHiddenDefault: boolean;
    seedDefaultWatchedPaths: boolean;
  }) {
    const now = nowIso();
    const row = this.db
      .prepare("SELECT id FROM app_settings WHERE id = 1")
      .get() as { id: number } | undefined;

    if (!row) {
      const userHome = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
      const organizedRoot = input.organizedRootPath ?? `${userHome}\\Organized`;
      const archiveRoot = `${organizedRoot}\\Archives`;
      const duplicateReview = `${organizedRoot}\\Duplicate Review`;
      this.db
        .prepare(
          `INSERT INTO app_settings (
            id, dry_run_default, rename_pattern, organized_root_path, archive_root_path, duplicate_review_path,
            report_day_of_week, auto_approve_low_risk, recent_file_safety_hours, include_hidden_default,
            created_at, updated_at
          ) VALUES (
            1, 1, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?
          )`
        )
        .run(
          "{date}_{label}_v{version}",
          organizedRoot,
          archiveRoot,
          duplicateReview,
          input.recentFileSafetyHours,
          input.includeHiddenDefault ? 1 : 0,
          now,
          now
        );
    }

    if (input.seedDefaultWatchedPaths) {
      // Optional bootstrap path seeding for non-sandbox setups.
      const downloads = process.env.USERPROFILE
        ? `${process.env.USERPROFILE}\\Downloads`
        : undefined;
      if (downloads) {
        const existing = this.db
          .prepare("SELECT id FROM watched_paths WHERE path = ?")
          .get(downloads) as { id: string } | undefined;
        if (!existing) {
          this.addWatchedPath({
            path: downloads,
            pathType: "downloads",
            isEnabled: true,
            isProtected: false,
            includeSubfolders: false
          });
        }
      }
    }
  }

  getSettings(): LocalSettings {
    const row = this.db
      .prepare("SELECT * FROM app_settings WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error("app_settings row not initialized");
    }
    return {
      dryRunDefault: Number(row.dry_run_default ?? 1) === 1,
      renamePattern: String(row.rename_pattern ?? "{date}_{label}_v{version}"),
      organizedRootPath: String(row.organized_root_path ?? ""),
      archiveRootPath: String(row.archive_root_path ?? ""),
      duplicateReviewPath: String(row.duplicate_review_path ?? ""),
      recentFileSafetyHours: Number(row.recent_file_safety_hours ?? 12),
      includeHiddenDefault: Number(row.include_hidden_default ?? 0) === 1
    };
  }

  updateSettings(patch: Partial<LocalSettings>) {
    const existing = this.getSettings();
    const next: LocalSettings = {
      ...existing,
      ...patch
    };
    this.db
      .prepare(
        `UPDATE app_settings
         SET dry_run_default = ?, rename_pattern = ?, organized_root_path = ?, archive_root_path = ?,
             duplicate_review_path = ?, recent_file_safety_hours = ?, include_hidden_default = ?, updated_at = ?
         WHERE id = 1`
      )
      .run(
        next.dryRunDefault ? 1 : 0,
        next.renamePattern,
        next.organizedRootPath,
        next.archiveRootPath,
        next.duplicateReviewPath,
        next.recentFileSafetyHours,
        next.includeHiddenDefault ? 1 : 0,
        nowIso()
      );
    return next;
  }

  listWatchedPaths(): WatchedPathRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM watched_paths ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      path: String(row.path),
      pathType: row.path_type as WatchedPathRecord["pathType"],
      isEnabled: Number(row.is_enabled) === 1,
      isProtected: Number(row.is_protected) === 1,
      includeSubfolders: Number(row.include_subfolders) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  getWatchedPath(id: string): WatchedPathRecord | null {
    const row = this.db
      .prepare("SELECT * FROM watched_paths WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      path: String(row.path),
      pathType: row.path_type as WatchedPathRecord["pathType"],
      isEnabled: Number(row.is_enabled) === 1,
      isProtected: Number(row.is_protected) === 1,
      includeSubfolders: Number(row.include_subfolders) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  addWatchedPath(input: {
    path: string;
    pathType: WatchedPathRecord["pathType"];
    isEnabled: boolean;
    isProtected: boolean;
    includeSubfolders: boolean;
  }): WatchedPathRecord {
    const now = nowIso();
    const id = createId("wp");
    this.db
      .prepare(
        `INSERT INTO watched_paths (
          id, path, path_type, is_enabled, is_protected, include_subfolders, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.path,
        input.pathType,
        input.isEnabled ? 1 : 0,
        input.isProtected ? 1 : 0,
        input.includeSubfolders ? 1 : 0,
        now,
        now
      );
    return this.getWatchedPath(id)!;
  }

  updateWatchedPath(
    id: string,
    patch: Partial<
      Pick<
        WatchedPathRecord,
        "path" | "pathType" | "isEnabled" | "isProtected" | "includeSubfolders"
      >
    >
  ): WatchedPathRecord | null {
    const current = this.getWatchedPath(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE watched_paths
         SET path = ?, path_type = ?, is_enabled = ?, is_protected = ?, include_subfolders = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.path,
        next.pathType,
        next.isEnabled ? 1 : 0,
        next.isProtected ? 1 : 0,
        next.includeSubfolders ? 1 : 0,
        next.updatedAt,
        id
      );
    return this.getWatchedPath(id);
  }

  deleteWatchedPath(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM watched_paths WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  createRun(runId: string, job: CleanupJob) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO cleanup_runs (
          id, job_id, device_id, trigger_type, dry_run, status, started_at, files_scanned,
          proposals_created, actions_executed, duplicates_found, bytes_recovered_estimate, skipped_for_safety, summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?)`
      )
      .run(
        runId,
        job.jobId,
        job.deviceId,
        job.triggerType,
        job.mode.dryRun ? 1 : 0,
        "running",
        nowIso(),
        JSON.stringify({
          runId,
          deviceId: job.deviceId,
          jobId: job.jobId
        })
      );
  }

  updateRunSummary(runId: string, patch: Partial<RunSummary>) {
    const current = this.getRunSummary(runId);
    if (!current) return;
    const next: RunSummary = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE cleanup_runs
         SET status = ?, finished_at = ?, files_scanned = ?, proposals_created = ?, actions_executed = ?,
             duplicates_found = ?, bytes_recovered_estimate = ?, skipped_for_safety = ?, summary_json = ?
         WHERE id = ?`
      )
      .run(
        next.status,
        next.finishedAt ?? null,
        next.filesScanned,
        next.proposalsCreated,
        next.actionsExecuted,
        next.duplicatesFound,
        next.bytesRecoveredEstimate,
        next.skippedForSafety,
        JSON.stringify(next),
        runId
      );
  }

  getRunSummary(runId: string): RunSummary | null {
    const row = this.db
      .prepare("SELECT * FROM cleanup_runs WHERE id = ?")
      .get(runId) as CleanupRunRow | undefined;
    if (!row) return null;

    if (row.summary_json) {
      const parsed = JSON.parse(row.summary_json) as Partial<RunSummary>;
      if (parsed.runId && parsed.jobId && parsed.deviceId) {
        return {
          runId: parsed.runId,
          deviceId: parsed.deviceId,
          jobId: parsed.jobId,
          status: (parsed.status ?? row.status) as RunSummary["status"],
          dryRun: parsed.dryRun ?? row.dry_run === 1,
          startedAt: parsed.startedAt ?? row.started_at,
          finishedAt: parsed.finishedAt ?? row.finished_at ?? undefined,
          filesScanned: parsed.filesScanned ?? row.files_scanned,
          proposalsCreated: parsed.proposalsCreated ?? row.proposals_created,
          actionsExecuted: parsed.actionsExecuted ?? row.actions_executed,
          duplicatesFound: parsed.duplicatesFound ?? row.duplicates_found,
          bytesRecoveredEstimate:
            parsed.bytesRecoveredEstimate ?? row.bytes_recovered_estimate,
          skippedForSafety: parsed.skippedForSafety ?? row.skipped_for_safety,
          errorMessage: parsed.errorMessage
        };
      }
    }

    return {
      runId: row.id,
      deviceId: row.device_id,
      jobId: row.job_id,
      status: row.status as RunSummary["status"],
      dryRun: row.dry_run === 1,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      filesScanned: row.files_scanned,
      proposalsCreated: row.proposals_created,
      actionsExecuted: row.actions_executed,
      duplicatesFound: row.duplicates_found,
      bytesRecoveredEstimate: row.bytes_recovered_estimate,
      skippedForSafety: row.skipped_for_safety
    };
  }

  listRuns(limit = 50): RunSnapshot[] {
    const rows = this.db
      .prepare("SELECT id FROM cleanup_runs ORDER BY started_at DESC LIMIT ?")
      .all(limit) as Array<{ id: string }>;
    return rows
      .map((row) => this.getRunSnapshot(row.id))
      .filter((row): row is RunSnapshot => row !== null);
  }

  listRunsPage(input?: {
    status?: RunSummary["status"];
    limit?: number;
    offset?: number;
  }): RunSnapshot[] {
    const status = input?.status;
    const limit = Math.max(1, Math.min(200, input?.limit ?? 50));
    const offset = Math.max(0, input?.offset ?? 0);

    const rows = status
      ? (this.db
          .prepare(
            "SELECT id FROM cleanup_runs WHERE status = ? ORDER BY started_at DESC LIMIT ? OFFSET ?"
          )
          .all(status, limit, offset) as Array<{ id: string }>)
      : (this.db
          .prepare("SELECT id FROM cleanup_runs ORDER BY started_at DESC LIMIT ? OFFSET ?")
          .all(limit, offset) as Array<{ id: string }>);

    return rows
      .map((row) => this.getRunSnapshot(row.id))
      .filter((row): row is RunSnapshot => row !== null);
  }

  countRuns(status?: RunSummary["status"]): number {
    if (status) {
      const row = this.db
        .prepare("SELECT COUNT(*) as count FROM cleanup_runs WHERE status = ?")
        .get(status) as { count: number } | undefined;
      return row?.count ?? 0;
    }
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM cleanup_runs")
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  replaceRunProposals(runId: string, proposals: ProposalResult[]) {
    this.db.prepare("DELETE FROM action_proposals WHERE batch_id = ?").run(runId);
    const stmt = this.db.prepare(
      `INSERT INTO action_proposals (
        id, file_id, action_type, reason, before_json, after_json, risk_level, confidence,
        approval_required, status, batch_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = nowIso();
    const tx = this.db.transaction(() => {
      for (const proposal of proposals) {
        stmt.run(
          proposal.proposalId,
          proposal.fileId,
          proposal.actionType,
          proposal.reason,
          JSON.stringify(proposal.before),
          JSON.stringify(proposal.after),
          proposal.riskLevel,
          proposal.confidence ?? null,
          proposal.approvalRequired ? 1 : 0,
          proposal.status ?? "proposed",
          runId,
          now
        );
      }
    });
    tx();
  }

  listRunProposals(runId: string): ProposalResult[] {
    const rows = this.db
      .prepare("SELECT * FROM action_proposals WHERE batch_id = ? ORDER BY created_at ASC")
      .all(runId) as ProposalRow[];
    return rows.map((row) => ({
      proposalId: row.id,
      fileId: row.file_id,
      actionType: row.action_type as ProposalResult["actionType"],
      reason: row.reason,
      before: JSON.parse(row.before_json),
      after: JSON.parse(row.after_json),
      riskLevel: row.risk_level,
      approvalRequired: row.approval_required === 1,
      confidence: row.confidence ?? undefined,
      rollbackPlan: {
        type: "move_back",
        target: JSON.parse(row.before_json).path
      },
      status: row.status
    }));
  }

  getRunSnapshot(runId: string): RunSnapshot | null {
    const summary = this.getRunSummary(runId);
    if (!summary) return null;
    const proposals = this.listRunProposals(runId);
    return { runSummary: summary, proposals };
  }

  applyApprovals(approvals: ApprovalCommand) {
    const now = nowIso();
    const stmt = this.db.prepare(
      "UPDATE action_proposals SET status = ?, after_json = ?, decided_at = ? WHERE id = ? AND batch_id = ?"
    );
    const tx = this.db.transaction(() => {
      for (const decision of approvals.approvals) {
        const current = this.db
          .prepare("SELECT after_json FROM action_proposals WHERE id = ?")
          .get(decision.proposalId) as { after_json: string } | undefined;
        if (!current) continue;
        stmt.run(
          decision.decision === "approve" ? "approved" : "rejected",
          JSON.stringify(decision.editedAfter ?? JSON.parse(current.after_json)),
          now,
          decision.proposalId,
          approvals.runId
        );
      }
    });
    tx();
  }

  upsertFileRecord(candidate: ScanCandidate): string {
    const existing = this.db
      .prepare("SELECT id FROM file_records WHERE absolute_path = ?")
      .get(candidate.absolutePath) as { id: string } | undefined;
    const stableFileId = existing?.id ?? candidate.fileId;
    this.db
      .prepare(
        `INSERT INTO file_records (
          id, absolute_path, parent_path, original_filename, current_filename, extension, mime_type,
          size_bytes, created_at_fs, modified_at_fs, last_seen_at, classification, confidence, risk_bucket
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(absolute_path) DO UPDATE SET
          parent_path = excluded.parent_path,
          current_filename = excluded.current_filename,
          extension = excluded.extension,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          created_at_fs = excluded.created_at_fs,
          modified_at_fs = excluded.modified_at_fs,
          last_seen_at = excluded.last_seen_at,
          classification = excluded.classification,
          confidence = excluded.confidence`
      )
      .run(
        stableFileId,
        candidate.absolutePath,
        candidate.parentPath,
        candidate.filename,
        candidate.filename,
        candidate.extension,
        candidate.mimeType,
        candidate.sizeBytes,
        candidate.createdAtFs,
        candidate.modifiedAtFs,
        nowIso(),
        candidate.classification ?? null,
        candidate.confidence ?? null,
        null
      );
    return stableFileId;
  }

  getFileRecordById(fileId: string): { absolutePath: string; sizeBytes: number } | null {
    const row = this.db
      .prepare("SELECT absolute_path, size_bytes FROM file_records WHERE id = ?")
      .get(fileId) as { absolute_path: string; size_bytes: number } | undefined;
    if (!row) return null;
    return { absolutePath: row.absolute_path, sizeBytes: row.size_bytes };
  }

  updateFilePath(fileId: string, nextAbsolutePath: string) {
    const filename = nextAbsolutePath.split(/[/\\]/).pop() ?? "";
    const parent = nextAbsolutePath.replace(/[/\\][^/\\]+$/, "");
    this.db
      .prepare(
        `UPDATE file_records
         SET absolute_path = ?, parent_path = ?, current_filename = ?, last_seen_at = ?
         WHERE id = ?`
      )
      .run(nextAbsolutePath, parent, filename, nowIso(), fileId);
  }

  insertExecution(record: ExecutionRecord) {
    this.db
      .prepare(
        `INSERT INTO action_executions (
          id, run_id, proposal_id, operation_type, success, error_message, rollback_json, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.executionId,
        record.runId,
        record.proposalId,
        record.operationType,
        record.success ? 1 : 0,
        record.errorMessage ?? null,
        record.rollbackJson ?? null,
        record.startedAt,
        record.finishedAt ?? null
      );
  }

  listExecutionsByRun(runId: string): ExecutionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM action_executions WHERE run_id = ? ORDER BY started_at DESC")
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      executionId: String(row.id),
      runId: String(row.run_id),
      proposalId: String(row.proposal_id),
      operationType: String(row.operation_type),
      success: Number(row.success) === 1,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      rollbackJson: row.rollback_json ? String(row.rollback_json) : undefined,
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : undefined
    }));
  }

  getExecution(executionId: string): ExecutionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM action_executions WHERE id = ?")
      .get(executionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      executionId: String(row.id),
      runId: String(row.run_id),
      proposalId: String(row.proposal_id),
      operationType: String(row.operation_type),
      success: Number(row.success) === 1,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      rollbackJson: row.rollback_json ? String(row.rollback_json) : undefined,
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : undefined
    };
  }

  updateProposalStatus(
    proposalId: string,
    status: ProposalResult["status"],
    executedAt?: string
  ) {
    this.db
      .prepare("UPDATE action_proposals SET status = ?, executed_at = ? WHERE id = ?")
      .run(status ?? "proposed", executedAt ?? null, proposalId);
  }

  getProposalById(proposalId: string): ProposalResult | null {
    const row = this.db
      .prepare("SELECT * FROM action_proposals WHERE id = ?")
      .get(proposalId) as ProposalRow | undefined;
    if (!row) return null;
    return {
      proposalId: row.id,
      fileId: row.file_id,
      actionType: row.action_type as ProposalResult["actionType"],
      reason: row.reason,
      before: JSON.parse(row.before_json),
      after: JSON.parse(row.after_json),
      riskLevel: row.risk_level,
      approvalRequired: row.approval_required === 1,
      confidence: row.confidence ?? undefined,
      rollbackPlan: {
        type: "move_back",
        target: JSON.parse(row.before_json).path
      },
      status: row.status
    };
  }

  markRunFailed(runId: string, errorMessage: string) {
    const summary = this.getRunSummary(runId);
    if (!summary) return;
    this.updateRunSummary(runId, {
      ...summary,
      status: "failed",
      errorMessage,
      finishedAt: nowIso()
    });
  }
}

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dry_run_default INTEGER NOT NULL DEFAULT 1,
  rename_pattern TEXT NOT NULL DEFAULT '{date}_{label}_v{version}',
  organized_root_path TEXT,
  archive_root_path TEXT,
  duplicate_review_path TEXT,
  report_day_of_week INTEGER NOT NULL DEFAULT 0,
  auto_approve_low_risk INTEGER NOT NULL DEFAULT 0,
  recent_file_safety_hours INTEGER NOT NULL DEFAULT 12,
  include_hidden_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watched_paths (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  path_type TEXT NOT NULL, -- downloads, desktop, screenshots, custom
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_protected INTEGER NOT NULL DEFAULT 0,
  include_subfolders INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_records (
  id TEXT PRIMARY KEY,
  absolute_path TEXT NOT NULL UNIQUE,
  parent_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  current_filename TEXT NOT NULL,
  extension TEXT,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL,
  created_at_fs TEXT,
  modified_at_fs TEXT,
  last_seen_at TEXT NOT NULL,
  sha256_hash TEXT,
  quick_fingerprint TEXT,
  classification TEXT,
  confidence REAL,
  project_tag TEXT,
  content_summary TEXT,
  risk_bucket TEXT,
  is_indexed INTEGER NOT NULL DEFAULT 0,
  is_deleted_missing INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_file_records_parent_path ON file_records(parent_path);
CREATE INDEX IF NOT EXISTS idx_file_records_classification ON file_records(classification);
CREATE INDEX IF NOT EXISTS idx_file_records_hash ON file_records(sha256_hash);

CREATE TABLE IF NOT EXISTS action_proposals (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  action_type TEXT NOT NULL, -- rename, move, archive, duplicate_group, index_only, manual_review
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  risk_level TEXT NOT NULL, -- low, medium, high
  confidence REAL,
  approval_required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, -- proposed, approved, rejected, executed, failed
  batch_id TEXT, -- runId
  created_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_action_proposals_status ON action_proposals(status);
CREATE INDEX IF NOT EXISTS idx_action_proposals_batch_id ON action_proposals(batch_id);

CREATE TABLE IF NOT EXISTS action_executions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  operation_type TEXT NOT NULL, -- rename, move, mkdir, rollback
  success INTEGER NOT NULL,
  error_message TEXT,
  rollback_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_action_executions_run_id ON action_executions(run_id);
CREATE INDEX IF NOT EXISTS idx_action_executions_proposal_id ON action_executions(proposal_id);

CREATE TABLE IF NOT EXISTS cleanup_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- manual, scheduled, watcher_event
  dry_run INTEGER NOT NULL,
  status TEXT NOT NULL, -- queued, running, awaiting_approval, completed, failed
  started_at TEXT NOT NULL,
  finished_at TEXT,
  files_scanned INTEGER NOT NULL DEFAULT 0,
  proposals_created INTEGER NOT NULL DEFAULT 0,
  actions_executed INTEGER NOT NULL DEFAULT 0,
  duplicates_found INTEGER NOT NULL DEFAULT 0,
  bytes_recovered_estimate INTEGER NOT NULL DEFAULT 0,
  skipped_for_safety INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS user_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id TEXT PRIMARY KEY,
  proposal_id TEXT,
  file_id TEXT,
  feedback_type TEXT NOT NULL,
  feedback_json TEXT,
  created_at TEXT NOT NULL
);

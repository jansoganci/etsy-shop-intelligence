-- Migration number: 0022
-- Immutable, Queue-driven reconciliation runs. Legacy reconciliation
-- generations remain available during the shadow comparison period.

CREATE TABLE IF NOT EXISTS etsy_reconciliation_runs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'sync_generation')),
  reporting_timezone TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  api_sync_run_id TEXT,
  csv_import_watermark TEXT,
  progress_total INTEGER NOT NULL DEFAULT 4,
  progress_completed INTEGER NOT NULL DEFAULT 0,
  current_step TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  summary_json TEXT,
  shadow_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES etsy_connections(shop_id)
);

CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_runs_latest
  ON etsy_reconciliation_runs(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_runs_active
  ON etsy_reconciliation_runs(shop_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS etsy_reconciliation_metric_results (
  id TEXT PRIMARY KEY,
  reconciliation_run_id TEXT NOT NULL,
  grain TEXT NOT NULL CHECK (grain IN ('global', 'monthly')),
  period_key TEXT,
  entity TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  api_value REAL,
  csv_value REAL,
  currency TEXT,
  difference REAL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  reason_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reconciliation_run_id) REFERENCES etsy_reconciliation_runs(id) ON DELETE CASCADE,
  UNIQUE(reconciliation_run_id, grain, period_key, entity, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_metrics_run
  ON etsy_reconciliation_metric_results(reconciliation_run_id, grain, period_key);

CREATE TABLE IF NOT EXISTS etsy_reconciliation_issues (
  id TEXT PRIMARY KEY,
  reconciliation_run_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  reason_code TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  record_date TEXT,
  amount REAL,
  currency TEXT,
  detail TEXT,
  match_method TEXT NOT NULL DEFAULT 'exact_id',
  match_confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reconciliation_run_id) REFERENCES etsy_reconciliation_runs(id) ON DELETE CASCADE,
  UNIQUE(reconciliation_run_id, entity, issue_type, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_issues_run
  ON etsy_reconciliation_issues(reconciliation_run_id, entity, issue_type);

CREATE TABLE IF NOT EXISTS etsy_reconciliation_matches (
  id TEXT PRIMARY KEY,
  reconciliation_run_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  api_record_id TEXT NOT NULL,
  csv_record_id TEXT NOT NULL,
  match_method TEXT NOT NULL CHECK (match_method IN ('exact_id', 'composite')),
  match_confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reconciliation_run_id) REFERENCES etsy_reconciliation_runs(id) ON DELETE CASCADE,
  UNIQUE(reconciliation_run_id, entity, api_record_id, csv_record_id)
);

CREATE TABLE IF NOT EXISTS etsy_reconciliation_outbox (
  id TEXT PRIMARY KEY,
  dispatch_key TEXT NOT NULL UNIQUE,
  reconciliation_run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY (reconciliation_run_id) REFERENCES etsy_reconciliation_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_outbox_dispatch
  ON etsy_reconciliation_outbox(status, available_at);

CREATE TRIGGER IF NOT EXISTS etsy_reconciliation_runs_completed_immutable
BEFORE UPDATE ON etsy_reconciliation_runs
WHEN OLD.status = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'completed reconciliation runs are immutable');
END;

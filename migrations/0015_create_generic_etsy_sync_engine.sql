-- Migration number: 0015
-- Generic, Queue-driven Etsy synchronization engine.
--
-- This migration is intentionally additive. The legacy etsy_sync_runs,
-- etsy_sync_resources and Workflow cursor tables are retained so the previous
-- Worker version can be restored without a destructive schema rollback.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS etsy_sync_jobs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  requested_resource TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued', 'running', 'retry_wait', 'rate_limited', 'partial',
      'completed', 'failed', 'cancelled', 'source_pagination_exhausted'
    )
  ),
  current_resource TEXT,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  failed_tasks INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  rate_limit_qpd_remaining INTEGER,
  rate_limit_qps_remaining INTEGER,
  last_heartbeat_at TEXT,
  next_resume_at TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    reconciliation_status IN ('pending', 'queued', 'running', 'completed', 'failed', 'skipped')
  ),
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES etsy_connections(shop_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_etsy_sync_jobs_one_active_shop
  ON etsy_sync_jobs(shop_id)
  WHERE status IN ('queued', 'running', 'retry_wait', 'rate_limited');

CREATE INDEX IF NOT EXISTS idx_etsy_sync_jobs_created
  ON etsy_sync_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_jobs_heartbeat
  ON etsy_sync_jobs(status, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS etsy_sync_job_resources (
  run_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  adapter_version INTEGER NOT NULL DEFAULT 1,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending', 'queued', 'running', 'retry_wait', 'rate_limited',
      'partial', 'completed', 'failed', 'skipped',
      'source_pagination_exhausted'
    )
  ),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, resource),
  FOREIGN KEY (run_id) REFERENCES etsy_sync_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etsy_sync_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  adapter_version INTEGER NOT NULL DEFAULT 1,
  strategy TEXT NOT NULL CHECK (
    strategy IN (
      'singleton', 'offset_paged', 'time_windowed',
      'parent_fanout', 'batch_by_id', 'local_derived'
    )
  ),
  idempotency_key TEXT NOT NULL UNIQUE,
  parent_task_id TEXT,
  dependency_key TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending', 'queued', 'running', 'retry_wait', 'rate_limited',
      'completed', 'failed', 'cancelled', 'source_pagination_exhausted'
    )
  ),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  segment_start INTEGER,
  segment_end INTEGER,
  page_offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 100 CHECK (page_size BETWEEN 1 AND 100),
  expected_count INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12,
  next_attempt_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (run_id) REFERENCES etsy_sync_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_task_id) REFERENCES etsy_sync_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_tasks_dispatch
  ON etsy_sync_tasks(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_tasks_stale_lease
  ON etsy_sync_tasks(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_tasks_run_resource
  ON etsy_sync_tasks(run_id, resource, status);

CREATE TABLE IF NOT EXISTS etsy_sync_page_commits (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  page_key TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  fetched_count INTEGER NOT NULL,
  inserted_count INTEGER NOT NULL,
  updated_count INTEGER NOT NULL,
  unchanged_count INTEGER NOT NULL,
  response_count INTEGER,
  response_fingerprint TEXT,
  counters_applied_at TEXT,
  committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (task_id, page_key),
  FOREIGN KEY (run_id) REFERENCES etsy_sync_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES etsy_sync_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_page_commits_run
  ON etsy_sync_page_commits(run_id, task_id);

-- D1 and Queue cannot commit atomically. The outbox is the durable hand-off:
-- a scheduled recovery pass can enqueue every row that remains pending.
CREATE TABLE IF NOT EXISTS etsy_sync_outbox (
  id TEXT PRIMARY KEY,
  dispatch_key TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sending', 'sent', 'failed')
  ),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY (run_id) REFERENCES etsy_sync_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES etsy_sync_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_outbox_dispatch
  ON etsy_sync_outbox(status, available_at);

CREATE TABLE IF NOT EXISTS etsy_api_rate_limit_state (
  limiter_key TEXT PRIMARY KEY,
  qps_limit INTEGER,
  qps_remaining INTEGER,
  qpd_limit INTEGER,
  qpd_remaining INTEGER,
  blocked_until TEXT,
  last_response_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS etsy_reconciliation_generations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'queued', 'running', 'completed', 'failed')
  ),
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  calculated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES etsy_sync_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES etsy_connections(shop_id)
);

CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_generations_latest
  ON etsy_reconciliation_generations(shop_id, calculated_at DESC);

-- Migration number: 0021
-- User-facing sync controls + soft daily budget settings.

ALTER TABLE etsy_sync_jobs ADD COLUMN control_state TEXT NOT NULL DEFAULT 'running';
ALTER TABLE etsy_sync_jobs ADD COLUMN pause_reason TEXT;
ALTER TABLE etsy_api_rate_limit_state ADD COLUMN soft_qpd_reserve INTEGER NOT NULL DEFAULT 300;

CREATE TABLE IF NOT EXISTS etsy_sync_soft_budget_day (
  day_key TEXT PRIMARY KEY,
  queue_ops INTEGER NOT NULL DEFAULT 0,
  d1_write_ops INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_etsy_sync_jobs_control
  ON etsy_sync_jobs(shop_id, control_state, status);

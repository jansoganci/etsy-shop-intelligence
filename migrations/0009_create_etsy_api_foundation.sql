-- Migration number: 0009
-- Etsy API OAuth connection and durable manual-sync state.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS etsy_connections (
  shop_id TEXT PRIMARY KEY,
  etsy_user_id TEXT NOT NULL,
  shop_name TEXT,
  scopes_json TEXT NOT NULL,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  access_token_expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauthorization_required', 'disconnected')),
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_api_success_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS etsy_oauth_states (
  state_hash TEXT PRIMARY KEY,
  pkce_verifier_ciphertext TEXT NOT NULL,
  pkce_verifier_iv TEXT NOT NULL,
  access_identity_hash TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_etsy_oauth_states_expires_at
  ON etsy_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS etsy_sync_runs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  requested_resource TEXT NOT NULL CHECK (
    requested_resource IN ('all', 'shop', 'listings', 'sales', 'finance', 'reviews')
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'running',
      'quota_paused',
      'partial',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  current_resource TEXT,
  workflow_instance_id TEXT,
  rate_limit_qpd_remaining INTEGER,
  rate_limit_qps_remaining INTEGER,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES etsy_connections(shop_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_etsy_sync_runs_one_active_shop
  ON etsy_sync_runs(shop_id)
  WHERE status IN ('queued', 'running', 'quota_paused');

CREATE INDEX IF NOT EXISTS idx_etsy_sync_runs_created
  ON etsy_sync_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS etsy_sync_resources (
  run_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (
    resource IN ('shop', 'listings', 'sales', 'finance', 'reviews', 'snapshots')
  ),
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'quota_paused', 'completed', 'failed', 'skipped')
  ),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  first_source_at TEXT,
  last_source_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, resource),
  FOREIGN KEY (run_id) REFERENCES etsy_sync_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etsy_sync_cursors (
  shop_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  cursor_key TEXT NOT NULL,
  cursor_value TEXT,
  last_success_at TEXT,
  initial_sync_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id, resource, cursor_key),
  FOREIGN KEY (shop_id) REFERENCES etsy_connections(shop_id)
);

CREATE TABLE IF NOT EXISTS etsy_sync_run_cursors (
  run_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  next_chunk INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, resource),
  FOREIGN KEY (run_id) REFERENCES etsy_sync_runs(id) ON DELETE CASCADE
);

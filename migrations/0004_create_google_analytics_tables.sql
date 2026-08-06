-- Migration number: 0004
-- Google Analytics D1 Sync Phase 1 schema
-- Adds GA sync tracking and report storage tables.

CREATE TABLE IF NOT EXISTS ga_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS ga_daily_metrics (
  property_id TEXT NOT NULL,
  date TEXT NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  screen_page_views INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, date)
);

CREATE TABLE IF NOT EXISTS ga_traffic_sources (
  property_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  channel_group TEXT NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  screen_page_views INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, date_from, date_to, channel_group)
);

CREATE TABLE IF NOT EXISTS ga_top_pages (
  property_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT,
  active_users INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  screen_page_views INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, date_from, date_to, page_path)
);

CREATE TABLE IF NOT EXISTS ga_countries (
  property_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  country TEXT NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, date_from, date_to, country)
);

CREATE TABLE IF NOT EXISTS ga_devices (
  property_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  device_category TEXT NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, date_from, date_to, device_category)
);

CREATE TABLE IF NOT EXISTS ga_events (
  property_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, date_from, date_to, event_name)
);

CREATE INDEX IF NOT EXISTS idx_ga_sync_runs_property_id ON ga_sync_runs(property_id);
CREATE INDEX IF NOT EXISTS idx_ga_sync_runs_started_at ON ga_sync_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_ga_daily_metrics_date ON ga_daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_ga_traffic_sources_range ON ga_traffic_sources(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_ga_top_pages_range ON ga_top_pages(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_ga_countries_range ON ga_countries(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_ga_devices_range ON ga_devices(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_ga_events_range ON ga_events(date_from, date_to);

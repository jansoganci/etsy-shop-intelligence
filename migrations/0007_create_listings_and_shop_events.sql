-- Migration number: 0007
-- Phase 3: form-entered listing catalog, version history, and shop change journal.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  first_seen_at TEXT NOT NULL,
  current_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  effective_at TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  description TEXT NOT NULL,
  image_alt_texts_json TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  change_note TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listing_versions_listing_id
  ON listing_versions(listing_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS shop_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'new_listing',
    'title_change',
    'seo_change',
    'description_change',
    'alt_text_change',
    'price_change',
    'discount_start',
    'discount_rate_change',
    'discount_end',
    'manual_note'
  )),
  listing_id TEXT REFERENCES listings(listing_id) ON DELETE SET NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  discount_rate REAL
    CHECK (discount_rate IS NULL OR (discount_rate >= 0 AND discount_rate <= 100)),
  date_from TEXT,
  date_to TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shop_events_date
  ON shop_events(event_date DESC);

CREATE INDEX IF NOT EXISTS idx_shop_events_listing
  ON shop_events(listing_id, event_date DESC);

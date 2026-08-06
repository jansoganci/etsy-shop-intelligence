-- Migration number: 0006
-- Phase 2: manually entered, completed-month Etsy Stats in canonical USD.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS etsy_monthly_stats (
  month TEXT PRIMARY KEY
    CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency = 'USD'),
  visits INTEGER NOT NULL CHECK (visits >= 0),
  orders INTEGER NOT NULL CHECK (orders >= 0),
  conversion_rate REAL NOT NULL CHECK (conversion_rate >= 0 AND conversion_rate <= 100),
  revenue REAL NOT NULL CHECK (revenue >= 0),
  item_favorites INTEGER NOT NULL CHECK (item_favorites >= 0),
  shop_follows INTEGER NOT NULL CHECK (shop_follows >= 0),
  reviews INTEGER NOT NULL CHECK (reviews >= 0),
  repeat_buyers INTEGER NOT NULL CHECK (repeat_buyers >= 0),
  cities_reached INTEGER NOT NULL CHECK (cities_reached >= 0),
  abandoned_carts INTEGER NOT NULL CHECK (abandoned_carts >= 0),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual_json',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS etsy_monthly_traffic_sources (
  month TEXT NOT NULL,
  source_key TEXT NOT NULL CHECK (
    source_key IN (
      'etsy_app_and_other_pages',
      'etsy_search',
      'etsy_marketing_and_seo',
      'direct_and_other_traffic',
      'social_media',
      'etsy_ads'
    )
  ),
  visits INTEGER NOT NULL CHECK (visits >= 0),
  share_percent REAL CHECK (
    share_percent IS NULL OR (share_percent >= 0 AND share_percent <= 100)
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (month, source_key),
  FOREIGN KEY (month) REFERENCES etsy_monthly_stats(month) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_monthly_stats_updated_at
  ON etsy_monthly_stats(updated_at);

CREATE INDEX IF NOT EXISTS idx_etsy_monthly_traffic_sources_month
  ON etsy_monthly_traffic_sources(month);

-- Migration number: 0020
-- Payment parent fan-out support: remember 404 probes and keyset-friendly indexes.

CREATE TABLE IF NOT EXISTS etsy_api_payment_probes (
  receipt_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  last_status TEXT NOT NULL,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_recheck_at TEXT,
  check_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_payment_probes_shop_recheck
  ON etsy_api_payment_probes(shop_id, next_recheck_at);

CREATE INDEX IF NOT EXISTS idx_etsy_api_payments_receipt_synced
  ON etsy_api_payments(receipt_id, synced_at);

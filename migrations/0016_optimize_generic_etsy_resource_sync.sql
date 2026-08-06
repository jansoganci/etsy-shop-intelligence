-- Migration number: 0016
-- Supporting indexes for dependency orchestration, batch-by-ID and
-- parent-fan-out adapters.
-- Additive only; no source or canonical data is rewritten.

CREATE INDEX IF NOT EXISTS idx_etsy_sync_job_resources_ready
  ON etsy_sync_job_resources(run_id, status, ordinal);

CREATE INDEX IF NOT EXISTS idx_etsy_api_receipts_shop_created_id
  ON etsy_api_receipts(shop_id, create_timestamp, receipt_id);

CREATE INDEX IF NOT EXISTS idx_etsy_api_listings_shop_listing
  ON etsy_api_listings(shop_id, listing_id);

CREATE INDEX IF NOT EXISTS idx_etsy_api_payments_shop_receipt
  ON etsy_api_payments(shop_id, receipt_id);

CREATE INDEX IF NOT EXISTS idx_etsy_api_ledger_shop_created
  ON etsy_api_ledger_entries(shop_id, create_timestamp);

CREATE INDEX IF NOT EXISTS idx_etsy_api_reviews_shop_created
  ON etsy_api_reviews(shop_id, create_timestamp);

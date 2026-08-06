-- Migration number: 0018
-- Preserve the Etsy review -> transaction relationship for review drill-down.

ALTER TABLE etsy_api_reviews ADD COLUMN transaction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_etsy_api_reviews_transaction
  ON etsy_api_reviews(transaction_id);

CREATE INDEX IF NOT EXISTS idx_etsy_api_reviews_shop_rating_created
  ON etsy_api_reviews(shop_id, rating, create_timestamp);

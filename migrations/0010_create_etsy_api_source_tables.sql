-- Migration number: 0010
-- Normalized Etsy API source tables. Receipt PII is deliberately allowlisted.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS etsy_api_shops (
  shop_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  title TEXT,
  announcement TEXT,
  currency_code TEXT,
  create_timestamp INTEGER,
  update_timestamp INTEGER,
  listing_active_count INTEGER,
  digital_listing_count INTEGER,
  review_count INTEGER,
  review_average REAL,
  url TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etsy_api_shop_sections (
  shop_section_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  title TEXT NOT NULL,
  rank INTEGER,
  active_listing_count INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES etsy_api_shops(shop_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etsy_api_listings (
  listing_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('active', 'inactive', 'sold_out', 'draft', 'expired')
  ),
  url TEXT NOT NULL,
  quantity INTEGER,
  price_amount INTEGER,
  price_divisor INTEGER,
  price_currency TEXT,
  taxonomy_id TEXT,
  shop_section_id TEXT,
  listing_type TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  materials_json TEXT NOT NULL DEFAULT '[]',
  num_favorers INTEGER,
  is_customizable INTEGER,
  is_personalizable INTEGER,
  personalization_json TEXT,
  creation_timestamp INTEGER,
  original_creation_timestamp INTEGER,
  ending_timestamp INTEGER,
  last_modified_timestamp INTEGER,
  state_timestamp INTEGER,
  content_hash TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES etsy_api_shops(shop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_listings_shop_state
  ON etsy_api_listings(shop_id, state);
CREATE INDEX IF NOT EXISTS idx_etsy_api_listings_modified
  ON etsy_api_listings(last_modified_timestamp);

CREATE TABLE IF NOT EXISTS etsy_api_listing_inventory (
  listing_id TEXT PRIMARY KEY,
  products_json TEXT NOT NULL,
  price_on_property_json TEXT NOT NULL DEFAULT '[]',
  quantity_on_property_json TEXT NOT NULL DEFAULT '[]',
  sku_on_property_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES etsy_api_listings(listing_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etsy_api_listing_images (
  listing_image_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  rank INTEGER,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  url_75x75 TEXT,
  url_170x135 TEXT,
  url_570xN TEXT,
  url_fullxfull TEXT,
  color_hex TEXT,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES etsy_api_listings(listing_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_listing_images_listing
  ON etsy_api_listing_images(listing_id, rank);

CREATE TABLE IF NOT EXISTS etsy_api_listing_videos (
  video_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  height INTEGER,
  width INTEGER,
  thumbnail_url TEXT,
  video_url TEXT,
  video_state TEXT,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES etsy_api_listings(listing_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS etsy_api_listing_files (
  listing_file_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  rank INTEGER,
  filename TEXT,
  filesize TEXT,
  size_bytes INTEGER,
  filetype TEXT,
  created_timestamp INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES etsy_api_listings(listing_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_listing_files_listing
  ON etsy_api_listing_files(listing_id, rank);

CREATE TABLE IF NOT EXISTS etsy_api_receipts (
  receipt_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  buyer_hash TEXT,
  city TEXT,
  country_iso TEXT,
  status TEXT,
  payment_method TEXT,
  is_paid INTEGER,
  is_shipped INTEGER,
  was_paid INTEGER,
  was_shipped INTEGER,
  was_canceled INTEGER,
  create_timestamp INTEGER,
  update_timestamp INTEGER,
  paid_timestamp INTEGER,
  shipped_timestamp INTEGER,
  grandtotal_amount INTEGER,
  grandtotal_divisor INTEGER,
  grandtotal_currency TEXT,
  subtotal_amount INTEGER,
  subtotal_divisor INTEGER,
  subtotal_currency TEXT,
  total_price_amount INTEGER,
  total_price_divisor INTEGER,
  total_price_currency TEXT,
  total_shipping_cost_amount INTEGER,
  total_shipping_cost_divisor INTEGER,
  total_shipping_cost_currency TEXT,
  total_tax_cost_amount INTEGER,
  total_tax_cost_divisor INTEGER,
  total_tax_cost_currency TEXT,
  total_vat_cost_amount INTEGER,
  total_vat_cost_divisor INTEGER,
  total_vat_cost_currency TEXT,
  discount_amt_amount INTEGER,
  discount_amt_divisor INTEGER,
  discount_amt_currency TEXT,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES etsy_api_shops(shop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_receipts_created
  ON etsy_api_receipts(create_timestamp);
CREATE INDEX IF NOT EXISTS idx_etsy_api_receipts_updated
  ON etsy_api_receipts(update_timestamp);
CREATE INDEX IF NOT EXISTS idx_etsy_api_receipts_buyer_hash
  ON etsy_api_receipts(buyer_hash);

CREATE TABLE IF NOT EXISTS etsy_api_transactions (
  transaction_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  listing_id TEXT,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sku TEXT,
  variations_json TEXT NOT NULL DEFAULT '[]',
  product_data_json TEXT NOT NULL DEFAULT '[]',
  price_amount INTEGER,
  price_divisor INTEGER,
  price_currency TEXT,
  shipping_cost_amount INTEGER,
  shipping_cost_divisor INTEGER,
  shipping_cost_currency TEXT,
  create_timestamp INTEGER,
  paid_timestamp INTEGER,
  shipped_timestamp INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES etsy_api_receipts(receipt_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_transactions_receipt
  ON etsy_api_transactions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_etsy_api_transactions_listing
  ON etsy_api_transactions(listing_id);

CREATE TABLE IF NOT EXISTS etsy_api_payments (
  payment_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  status TEXT,
  payment_method TEXT,
  amount_gross INTEGER,
  amount_gross_divisor INTEGER,
  amount_gross_currency TEXT,
  amount_fees INTEGER,
  amount_fees_divisor INTEGER,
  amount_fees_currency TEXT,
  amount_net INTEGER,
  amount_net_divisor INTEGER,
  amount_net_currency TEXT,
  posted_gross INTEGER,
  posted_gross_divisor INTEGER,
  posted_gross_currency TEXT,
  posted_fees INTEGER,
  posted_fees_divisor INTEGER,
  posted_fees_currency TEXT,
  posted_net INTEGER,
  posted_net_divisor INTEGER,
  posted_net_currency TEXT,
  adjusted_gross INTEGER,
  adjusted_gross_divisor INTEGER,
  adjusted_gross_currency TEXT,
  adjusted_fees INTEGER,
  adjusted_fees_divisor INTEGER,
  adjusted_fees_currency TEXT,
  adjusted_net INTEGER,
  adjusted_net_divisor INTEGER,
  adjusted_net_currency TEXT,
  create_timestamp INTEGER,
  update_timestamp INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES etsy_api_shops(shop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_payments_receipt
  ON etsy_api_payments(receipt_id);

CREATE TABLE IF NOT EXISTS etsy_api_ledger_entries (
  entry_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  ledger_id TEXT,
  sequence_number INTEGER,
  amount INTEGER,
  currency TEXT,
  description TEXT,
  balance INTEGER,
  create_timestamp INTEGER,
  ledger_type TEXT,
  reference_type TEXT,
  reference_id TEXT,
  parent_entry_id TEXT,
  payment_adjustments_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES etsy_api_shops(shop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_ledger_created
  ON etsy_api_ledger_entries(create_timestamp);

CREATE TABLE IF NOT EXISTS etsy_api_reviews (
  review_key TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  listing_id TEXT,
  rating INTEGER NOT NULL,
  review_text TEXT,
  language TEXT,
  image_url TEXT,
  create_timestamp INTEGER,
  update_timestamp INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES etsy_api_shops(shop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_reviews_listing
  ON etsy_api_reviews(listing_id, create_timestamp);

CREATE TABLE IF NOT EXISTS etsy_listing_metric_snapshots (
  listing_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  num_favorers INTEGER,
  quantity INTEGER,
  state TEXT,
  PRIMARY KEY (listing_id, captured_at),
  FOREIGN KEY (listing_id) REFERENCES etsy_api_listings(listing_id) ON DELETE CASCADE
);


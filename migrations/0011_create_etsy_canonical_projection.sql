-- Migration number: 0011
-- Expand the local listing catalog and introduce API-first/CSV-fallback views.

PRAGMA foreign_keys = OFF;

ALTER TABLE shop_events RENAME TO shop_events_legacy_0011;
ALTER TABLE listing_versions RENAME TO listing_versions_legacy_0011;
ALTER TABLE listings RENAME TO listings_legacy_0011;

DROP INDEX IF EXISTS idx_listing_versions_listing_id;
DROP INDEX IF EXISTS idx_shop_events_date;
DROP INDEX IF EXISTS idx_shop_events_listing;

CREATE TABLE listings (
  listing_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'sold_out', 'draft', 'expired')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'etsy_api', 'manual_only')),
  first_seen_at TEXT NOT NULL,
  etsy_last_modified_at TEXT,
  current_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE listing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  effective_at TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  description TEXT NOT NULL,
  image_alt_texts_json TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'inactive', 'sold_out', 'draft', 'expired')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'etsy_api')),
  change_note TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_listing_versions_listing_id
  ON listing_versions(listing_id, effective_at DESC);

CREATE TABLE shop_events (
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

INSERT INTO listings (
  listing_id, url, status, source, first_seen_at, current_version_id, created_at, updated_at
)
SELECT
  listing_id, url, status, 'manual_only', first_seen_at, current_version_id, created_at, updated_at
FROM listings_legacy_0011;

INSERT INTO listing_versions (
  id, listing_id, effective_at, title, tags_json, description,
  image_alt_texts_json, price, currency, status, source,
  change_note, content_hash, created_at
)
SELECT
  id, listing_id, effective_at, title, tags_json, description,
  image_alt_texts_json, price, currency, status, 'manual',
  change_note, content_hash, created_at
FROM listing_versions_legacy_0011;

INSERT INTO shop_events
SELECT * FROM shop_events_legacy_0011;

CREATE INDEX idx_shop_events_date ON shop_events(event_date DESC);
CREATE INDEX idx_shop_events_listing ON shop_events(listing_id, event_date DESC);

DROP TABLE shop_events_legacy_0011;
DROP TABLE listing_versions_legacy_0011;
DROP TABLE listings_legacy_0011;

PRAGMA foreign_keys = ON;

DROP VIEW IF EXISTS v_orders_canonical;
CREATE VIEW v_orders_canonical AS
SELECT
  r.receipt_id AS order_id_raw,
  r.receipt_id AS order_id,
  r.receipt_id AS order_id_normalized,
  datetime(r.create_timestamp, 'unixepoch') AS sale_date_raw,
  date(r.create_timestamp, 'unixepoch') AS sale_date,
  r.buyer_hash AS buyer_user_id,
  (SELECT COUNT(*) FROM etsy_api_transactions t WHERE t.receipt_id = r.receipt_id)
    AS number_of_items,
  r.country_iso AS ship_country,
  r.city AS ship_city,
  r.grandtotal_currency AS order_currency,
  CASE WHEN r.grandtotal_divisor > 0
    THEN r.grandtotal_amount * 1.0 / r.grandtotal_divisor END AS order_value,
  NULL AS coupon_code,
  NULL AS coupon_details,
  CASE WHEN r.discount_amt_divisor > 0
    THEN r.discount_amt_amount * 1.0 / r.discount_amt_divisor END AS discount_amount,
  NULL AS shipping_discount,
  CASE WHEN r.total_shipping_cost_divisor > 0
    THEN r.total_shipping_cost_amount * 1.0 / r.total_shipping_cost_divisor END AS shipping,
  CASE WHEN r.total_tax_cost_divisor > 0
    THEN r.total_tax_cost_amount * 1.0 / r.total_tax_cost_divisor END AS sales_tax,
  CASE WHEN r.grandtotal_divisor > 0
    THEN r.grandtotal_amount * 1.0 / r.grandtotal_divisor END AS order_total,
  r.status AS order_status,
  NULL AS payout_card_processing_fees,
  NULL AS payout_order_net,
  NULL AS adjusted_order_total,
  NULL AS payout_adjusted_card_processing_fees,
  NULL AS payout_adjusted_net_order_amount,
  'online' AS order_type,
  r.payment_method AS payment_type,
  NULL AS sku,
  NULL AS import_id,
  r.synced_at AS created_at,
  r.synced_at AS updated_at,
  'etsy_api' AS data_source
FROM etsy_api_receipts r
WHERE EXISTS (
  SELECT 1
  FROM etsy_sync_resources sr
  JOIN etsy_sync_runs run ON run.id = sr.run_id
  WHERE run.shop_id = r.shop_id
    AND sr.resource = 'sales'
    AND sr.status = 'completed'
)
UNION ALL
SELECT o.*, 'csv_upload' AS data_source
FROM v_orders_clean o
WHERE NOT EXISTS (
  SELECT 1
  FROM etsy_api_receipts r
  WHERE r.receipt_id = o.order_id
    AND EXISTS (
      SELECT 1
      FROM etsy_sync_resources sr
      JOIN etsy_sync_runs run ON run.id = sr.run_id
      WHERE run.shop_id = r.shop_id
        AND sr.resource = 'sales'
        AND sr.status = 'completed'
    )
);

DROP VIEW IF EXISTS v_order_items_canonical;
CREATE VIEW v_order_items_canonical AS
SELECT
  t.transaction_id,
  t.receipt_id AS order_id_raw,
  t.receipt_id AS order_id,
  t.receipt_id AS order_id_normalized,
  t.listing_id,
  datetime(COALESCE(t.create_timestamp, r.create_timestamp), 'unixepoch') AS sale_date_raw,
  date(COALESCE(t.create_timestamp, r.create_timestamp), 'unixepoch') AS sale_date,
  t.title AS listing_title,
  t.quantity,
  CASE WHEN t.price_divisor > 0 THEN t.price_amount * 1.0 / t.price_divisor END AS price,
  NULL AS coupon_code,
  NULL AS coupon_details,
  CASE WHEN r.discount_amt_divisor > 0
    THEN r.discount_amt_amount * 1.0 / r.discount_amt_divisor END AS discount_amount,
  NULL AS shipping_discount,
  CASE WHEN t.shipping_cost_divisor > 0
    THEN t.shipping_cost_amount * 1.0 / t.shipping_cost_divisor END AS order_shipping,
  NULL AS order_sales_tax,
  CASE WHEN t.price_divisor > 0
    THEN (t.price_amount * t.quantity) * 1.0 / t.price_divisor END AS item_total,
  t.price_currency AS item_currency,
  datetime(t.paid_timestamp, 'unixepoch') AS date_paid,
  datetime(t.shipped_timestamp, 'unixepoch') AS date_shipped,
  r.country_iso AS ship_country,
  r.city AS ship_city,
  t.variations_json AS variations,
  'online' AS order_type,
  l.listing_type AS listings_type,
  r.payment_method AS payment_type,
  NULL AS vat_paid_by_buyer,
  t.sku,
  NULL AS import_id,
  t.synced_at AS created_at,
  t.synced_at AS updated_at,
  'etsy_api' AS data_source
FROM etsy_api_transactions t
JOIN etsy_api_receipts r ON r.receipt_id = t.receipt_id
LEFT JOIN etsy_api_listings l ON l.listing_id = t.listing_id
WHERE EXISTS (
  SELECT 1
  FROM etsy_sync_resources sr
  JOIN etsy_sync_runs run ON run.id = sr.run_id
  WHERE run.shop_id = r.shop_id
    AND sr.resource = 'sales'
    AND sr.status = 'completed'
)
UNION ALL
SELECT oi.*, 'csv_upload' AS data_source
FROM v_order_items_clean oi
WHERE NOT EXISTS (
  SELECT 1
  FROM etsy_api_transactions t
  JOIN etsy_api_receipts r ON r.receipt_id = t.receipt_id
  WHERE t.transaction_id = oi.transaction_id
    AND EXISTS (
      SELECT 1
      FROM etsy_sync_resources sr
      JOIN etsy_sync_runs run ON run.id = sr.run_id
      WHERE run.shop_id = r.shop_id
        AND sr.resource = 'sales'
        AND sr.status = 'completed'
    )
);

DROP VIEW IF EXISTS v_payments_canonical;
CREATE VIEW v_payments_canonical AS
SELECT
  p.payment_id,
  p.receipt_id AS order_id_raw,
  p.receipt_id AS order_id,
  p.receipt_id AS order_id_normalized,
  datetime(p.create_timestamp, 'unixepoch') AS order_date_raw,
  date(p.create_timestamp, 'unixepoch') AS order_date,
  NULL AS funds_available_raw,
  NULL AS funds_available_date,
  CASE WHEN p.amount_gross_divisor > 0
    THEN p.amount_gross * 1.0 / p.amount_gross_divisor END AS gross_amount,
  CASE WHEN p.amount_fees_divisor > 0
    THEN p.amount_fees * 1.0 / p.amount_fees_divisor END AS fees,
  CASE WHEN p.amount_net_divisor > 0
    THEN p.amount_net * 1.0 / p.amount_net_divisor END AS net_amount,
  CASE WHEN p.posted_gross_divisor > 0
    THEN p.posted_gross * 1.0 / p.posted_gross_divisor END AS posted_gross,
  CASE WHEN p.posted_fees_divisor > 0
    THEN p.posted_fees * 1.0 / p.posted_fees_divisor END AS posted_fees,
  CASE WHEN p.posted_net_divisor > 0
    THEN p.posted_net * 1.0 / p.posted_net_divisor END AS posted_net,
  CASE WHEN p.adjusted_gross_divisor > 0
    THEN p.adjusted_gross * 1.0 / p.adjusted_gross_divisor END AS adjusted_gross,
  CASE WHEN p.adjusted_fees_divisor > 0
    THEN p.adjusted_fees * 1.0 / p.adjusted_fees_divisor END AS adjusted_fees,
  CASE WHEN p.adjusted_net_divisor > 0
    THEN p.adjusted_net * 1.0 / p.adjusted_net_divisor END AS adjusted_net,
  p.amount_gross_currency AS payment_currency,
  NULL AS listing_amount,
  p.amount_gross_currency AS listing_currency,
  NULL AS exchange_rate,
  NULL AS vat_amount,
  NULL AS gift_card_applied,
  p.status AS payment_status,
  'online' AS order_type,
  p.payment_method AS payment_type,
  NULL AS refund_amount,
  NULL AS import_id,
  p.synced_at AS created_at,
  p.synced_at AS updated_at,
  'etsy_api' AS data_source
FROM etsy_api_payments p
WHERE EXISTS (
  SELECT 1
  FROM etsy_sync_resources sr
  JOIN etsy_sync_runs run ON run.id = sr.run_id
  WHERE run.shop_id = p.shop_id
    AND sr.resource = 'finance'
    AND sr.status = 'completed'
)
UNION ALL
SELECT pc.*, 'csv_upload' AS data_source
FROM v_payments_clean pc
WHERE NOT EXISTS (
  SELECT 1
  FROM etsy_api_payments p
  WHERE p.payment_id = pc.payment_id
    AND EXISTS (
      SELECT 1
      FROM etsy_sync_resources sr
      JOIN etsy_sync_runs run ON run.id = sr.run_id
      WHERE run.shop_id = p.shop_id
        AND sr.resource = 'finance'
        AND sr.status = 'completed'
    )
);

DROP VIEW IF EXISTS v_payments_by_order_canonical;
CREATE VIEW v_payments_by_order_canonical AS
SELECT
  order_id,
  order_id_normalized,
  COUNT(*) AS payment_row_count,
  group_concat(payment_id) AS payment_ids,
  SUM(gross_amount) AS gross_amount,
  SUM(fees) AS fees,
  SUM(net_amount) AS net_amount,
  SUM(posted_gross) AS posted_gross,
  SUM(posted_fees) AS posted_fees,
  SUM(posted_net) AS posted_net,
  SUM(adjusted_gross) AS adjusted_gross,
  SUM(adjusted_fees) AS adjusted_fees,
  SUM(adjusted_net) AS adjusted_net,
  SUM(refund_amount) AS refund_amount,
  COUNT(DISTINCT payment_status) AS payment_status_count,
  CASE WHEN COUNT(DISTINCT payment_status) = 1
    THEN MIN(payment_status) ELSE 'mixed' END AS payment_status,
  group_concat(DISTINCT payment_status) AS payment_status_values,
  COUNT(DISTINCT payment_currency) AS payment_currency_count,
  CASE WHEN COUNT(DISTINCT payment_currency) > 1 THEN 1 ELSE 0 END
    AS has_mixed_payment_currency,
  CASE WHEN COUNT(DISTINCT payment_currency) = 1
    THEN MIN(payment_currency) END AS payment_currency,
  COUNT(DISTINCT listing_currency) AS listing_currency_count,
  CASE WHEN COUNT(DISTINCT listing_currency) > 1 THEN 1 ELSE 0 END
    AS has_mixed_listing_currency,
  CASE WHEN COUNT(DISTINCT listing_currency) = 1
    THEN MIN(listing_currency) END AS listing_currency,
  AVG(exchange_rate) AS average_exchange_rate,
  MAX(exchange_rate) AS max_exchange_rate,
  MIN(order_date) AS first_order_date,
  MAX(order_date) AS last_order_date,
  MIN(funds_available_date) AS first_funds_available_date,
  MAX(funds_available_date) AS last_funds_available_date
FROM v_payments_canonical
GROUP BY order_id, order_id_normalized;

-- Migration number: 0005
-- Etsy Dashboard v2 database preparation
-- Keeps source tables intact, hardens import tracking, and adds clean/query views.

-- Imports table hardening.
ALTER TABLE imports ADD COLUMN detected_type TEXT;
ALTER TABLE imports ADD COLUMN declared_type TEXT;
ALTER TABLE imports ADD COLUMN inserted_count INTEGER;
ALTER TABLE imports ADD COLUMN replaced_count INTEGER;
ALTER TABLE imports ADD COLUMN skipped_count INTEGER;
ALTER TABLE imports ADD COLUMN error_count INTEGER;
ALTER TABLE imports ADD COLUMN started_at TEXT;
ALTER TABLE imports ADD COLUMN completed_at TEXT;
ALTER TABLE imports ADD COLUMN failed_at TEXT;
ALTER TABLE imports ADD COLUMN failure_reason TEXT;

UPDATE imports
SET
  detected_type = COALESCE(detected_type, import_type),
  declared_type = COALESCE(declared_type, import_type),
  inserted_count = COALESCE(inserted_count, row_count),
  replaced_count = COALESCE(replaced_count, 0),
  skipped_count = COALESCE(skipped_count, 0),
  error_count = COALESCE(error_count, 0),
  started_at = COALESCE(started_at, imported_at),
  completed_at = CASE
    WHEN status = 'completed' THEN COALESCE(completed_at, imported_at)
    ELSE completed_at
  END,
  failed_at = CASE
    WHEN status = 'failed' THEN COALESCE(failed_at, imported_at)
    ELSE failed_at
  END,
  failure_reason = COALESCE(failure_reason, error_message);

CREATE INDEX IF NOT EXISTS idx_imports_file_hash ON imports(file_hash);
CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);
CREATE INDEX IF NOT EXISTS idx_imports_started_at ON imports(started_at);
CREATE INDEX IF NOT EXISTS idx_imports_completed_file_hash_type
  ON imports(import_type, file_hash, status);

-- D1/SQLite can support a partial unique index here. Null or blank hashes still bypass it,
-- so application-side hashing/validation remains necessary.
CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_completed_file_hash_type_unique
  ON imports(import_type, file_hash)
  WHERE status = 'completed'
    AND file_hash IS NOT NULL
    AND TRIM(file_hash) <> '';

-- Source table index hardening.
CREATE INDEX IF NOT EXISTS idx_orders_ship_city ON orders(ship_city);
CREATE INDEX IF NOT EXISTS idx_orders_coupon_code ON orders(coupon_code);
CREATE INDEX IF NOT EXISTS idx_orders_currency ON orders(currency);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE INDEX IF NOT EXISTS idx_order_items_ship_country ON order_items(ship_country);
CREATE INDEX IF NOT EXISTS idx_order_items_ship_city ON order_items(ship_city);
CREATE INDEX IF NOT EXISTS idx_order_items_coupon_code ON order_items(coupon_code);
CREATE INDEX IF NOT EXISTS idx_order_items_currency ON order_items(currency);

CREATE INDEX IF NOT EXISTS idx_payments_funds_available ON payments(funds_available);
CREATE INDEX IF NOT EXISTS idx_payments_currency ON payments(currency);
CREATE INDEX IF NOT EXISTS idx_payments_listing_currency ON payments(listing_currency);

DROP VIEW IF EXISTS v_orders_clean;
CREATE VIEW v_orders_clean AS
SELECT
  order_id AS order_id_raw,
  TRIM(order_id) AS order_id,
  TRIM(order_id) AS order_id_normalized,
  sale_date AS sale_date_raw,
  CASE
    WHEN sale_date LIKE '__/__/____%' THEN
      substr(sale_date, 7, 4) || '-' || substr(sale_date, 1, 2) || '-' || substr(sale_date, 4, 2)
    WHEN sale_date LIKE '__/__/__%' THEN
      '20' || substr(sale_date, 7, 2) || '-' || substr(sale_date, 1, 2) || '-' || substr(sale_date, 4, 2)
    WHEN sale_date LIKE '____-__-__%' THEN
      substr(sale_date, 1, 10)
    ELSE NULL
  END AS sale_date,
  buyer_user_id,
  number_of_items,
  ship_country,
  ship_city,
  currency AS order_currency,
  order_value,
  coupon_code,
  coupon_details,
  discount_amount,
  shipping_discount,
  shipping,
  sales_tax,
  order_total,
  status AS order_status,
  card_processing_fees AS payout_card_processing_fees,
  order_net AS payout_order_net,
  adjusted_order_total,
  adjusted_card_processing_fees AS payout_adjusted_card_processing_fees,
  adjusted_net_order_amount AS payout_adjusted_net_order_amount,
  order_type,
  payment_type,
  sku,
  import_id,
  created_at,
  updated_at
FROM orders;

DROP VIEW IF EXISTS v_order_items_clean;
CREATE VIEW v_order_items_clean AS
SELECT
  transaction_id,
  order_id AS order_id_raw,
  TRIM(order_id) AS order_id,
  TRIM(order_id) AS order_id_normalized,
  listing_id,
  sale_date AS sale_date_raw,
  CASE
    WHEN sale_date LIKE '__/__/____%' THEN
      substr(sale_date, 7, 4) || '-' || substr(sale_date, 1, 2) || '-' || substr(sale_date, 4, 2)
    WHEN sale_date LIKE '__/__/__%' THEN
      '20' || substr(sale_date, 7, 2) || '-' || substr(sale_date, 1, 2) || '-' || substr(sale_date, 4, 2)
    WHEN sale_date LIKE '____-__-__%' THEN
      substr(sale_date, 1, 10)
    ELSE NULL
  END AS sale_date,
  item_name AS listing_title,
  quantity,
  price,
  coupon_code,
  coupon_details,
  discount_amount,
  shipping_discount,
  order_shipping,
  order_sales_tax,
  item_total,
  currency AS item_currency,
  date_paid,
  date_shipped,
  ship_country,
  ship_city,
  variations,
  order_type,
  listings_type,
  payment_type,
  vat_paid_by_buyer,
  sku,
  import_id,
  created_at,
  updated_at
FROM order_items;

DROP VIEW IF EXISTS v_payments_clean;
CREATE VIEW v_payments_clean AS
SELECT
  payment_id,
  order_id AS order_id_raw,
  TRIM(order_id) AS order_id,
  TRIM(order_id) AS order_id_normalized,
  order_date AS order_date_raw,
  CASE
    WHEN order_date LIKE '__/__/____%' THEN
      substr(order_date, 7, 4) || '-' || substr(order_date, 1, 2) || '-' || substr(order_date, 4, 2)
    WHEN order_date LIKE '__/__/__%' THEN
      '20' || substr(order_date, 7, 2) || '-' || substr(order_date, 1, 2) || '-' || substr(order_date, 4, 2)
    WHEN order_date LIKE '____-__-__%' THEN
      substr(order_date, 1, 10)
    ELSE NULL
  END AS order_date,
  funds_available AS funds_available_raw,
  CASE
    WHEN funds_available LIKE '__/__/____%' THEN
      substr(funds_available, 7, 4) || '-' || substr(funds_available, 1, 2) || '-' || substr(funds_available, 4, 2)
    WHEN funds_available LIKE '__/__/__%' THEN
      '20' || substr(funds_available, 7, 2) || '-' || substr(funds_available, 1, 2) || '-' || substr(funds_available, 4, 2)
    WHEN funds_available LIKE '____-__-__%' THEN
      substr(funds_available, 1, 10)
    ELSE NULL
  END AS funds_available_date,
  gross_amount,
  fees,
  net_amount,
  posted_gross,
  posted_fees,
  posted_net,
  adjusted_gross,
  adjusted_fees,
  adjusted_net,
  currency AS payment_currency,
  listing_amount,
  listing_currency,
  exchange_rate,
  vat_amount,
  gift_card_applied,
  status AS payment_status,
  order_type,
  payment_type,
  refund_amount,
  import_id,
  created_at,
  updated_at
FROM payments;

DROP VIEW IF EXISTS v_payments_by_order;
CREATE VIEW v_payments_by_order AS
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
  CASE
    WHEN COUNT(DISTINCT payment_status) = 1 THEN MIN(payment_status)
    ELSE 'mixed'
  END AS payment_status,
  group_concat(DISTINCT payment_status) AS payment_status_values,
  COUNT(DISTINCT payment_currency) AS payment_currency_count,
  CASE
    WHEN COUNT(DISTINCT payment_currency) > 1 THEN 1
    ELSE 0
  END AS has_mixed_payment_currency,
  CASE
    WHEN COUNT(DISTINCT payment_currency) = 1 THEN MIN(payment_currency)
    ELSE NULL
  END AS payment_currency,
  COUNT(DISTINCT listing_currency) AS listing_currency_count,
  CASE
    WHEN COUNT(DISTINCT listing_currency) > 1 THEN 1
    ELSE 0
  END AS has_mixed_listing_currency,
  CASE
    WHEN COUNT(DISTINCT listing_currency) = 1 THEN MIN(listing_currency)
    ELSE NULL
  END AS listing_currency,
  AVG(exchange_rate) AS average_exchange_rate,
  MAX(exchange_rate) AS max_exchange_rate,
  MIN(order_date) AS first_order_date,
  MAX(order_date) AS last_order_date,
  MIN(funds_available_date) AS first_funds_available_date,
  MAX(funds_available_date) AS last_funds_available_date
FROM v_payments_clean
GROUP BY order_id, order_id_normalized;

DROP VIEW IF EXISTS v_sales_master;
CREATE VIEW v_sales_master AS
SELECT
  oi.transaction_id,
  oi.order_id,
  oi.order_id_raw AS order_id_raw,
  oi.order_id_normalized,
  oi.listing_id,
  oi.listing_title,
  oi.sale_date_raw AS item_sale_date_raw,
  oi.sale_date AS item_sale_date,
  oi.quantity,
  oi.price,
  oi.coupon_code AS item_coupon_code,
  oi.coupon_details AS item_coupon_details,
  oi.discount_amount AS item_discount_amount,
  oi.shipping_discount AS item_shipping_discount,
  oi.order_shipping,
  oi.order_sales_tax,
  oi.item_total,
  oi.item_currency,
  oi.date_paid,
  oi.date_shipped,
  oi.ship_country AS item_ship_country,
  oi.ship_city AS item_ship_city,
  oi.variations,
  oi.order_type AS item_order_type,
  oi.listings_type,
  oi.payment_type AS item_payment_type,
  oi.vat_paid_by_buyer,
  oi.sku AS item_sku,
  oi.import_id AS order_item_import_id,
  oi.created_at AS order_item_created_at,
  oi.updated_at AS order_item_updated_at,
  o.sale_date_raw AS order_sale_date_raw,
  o.sale_date AS order_sale_date,
  o.buyer_user_id,
  o.number_of_items,
  o.ship_country AS order_ship_country,
  o.ship_city AS order_ship_city,
  o.order_currency,
  o.order_value,
  o.coupon_code AS order_coupon_code,
  o.coupon_details AS order_coupon_details,
  o.discount_amount AS order_discount_amount,
  o.shipping_discount AS order_shipping_discount,
  o.shipping,
  o.sales_tax,
  o.order_total,
  o.order_status,
  o.payout_card_processing_fees,
  o.payout_order_net,
  o.adjusted_order_total,
  o.payout_adjusted_card_processing_fees,
  o.payout_adjusted_net_order_amount,
  o.order_type AS order_order_type,
  o.payment_type AS order_payment_type,
  o.sku AS order_sku,
  o.import_id AS order_import_id,
  o.created_at AS order_created_at,
  o.updated_at AS order_updated_at,
  p.payment_row_count,
  p.payment_ids,
  p.gross_amount AS payment_gross_amount,
  p.fees AS payment_fees,
  p.net_amount AS payment_net_amount,
  p.posted_gross AS payment_posted_gross,
  p.posted_fees AS payment_posted_fees,
  p.posted_net AS payment_posted_net,
  p.adjusted_gross AS payment_adjusted_gross,
  p.adjusted_fees AS payment_adjusted_fees,
  p.adjusted_net AS payment_adjusted_net,
  p.refund_amount AS payment_refund_amount,
  p.payment_status_count,
  p.payment_status,
  p.payment_status_values,
  p.payment_currency_count,
  p.has_mixed_payment_currency,
  p.payment_currency,
  p.listing_currency_count,
  p.has_mixed_listing_currency,
  p.listing_currency,
  p.average_exchange_rate,
  p.max_exchange_rate,
  p.first_order_date AS first_payment_order_date,
  p.last_order_date AS last_payment_order_date,
  p.first_funds_available_date,
  p.last_funds_available_date,
  CASE
    WHEN o.order_id IS NOT NULL THEN 1
    ELSE 0
  END AS has_order_match,
  CASE
    WHEN p.order_id IS NOT NULL THEN 1
    ELSE 0
  END AS has_payment_match,
  CASE
    WHEN o.order_id IS NOT NULL AND p.order_id IS NOT NULL THEN 'complete'
    WHEN o.order_id IS NULL AND p.order_id IS NULL THEN 'missing_order_and_payment'
    WHEN o.order_id IS NULL THEN 'missing_order'
    ELSE 'missing_payment'
  END AS join_status
FROM v_order_items_clean AS oi
LEFT JOIN v_orders_clean AS o
  ON oi.order_id = o.order_id
LEFT JOIN v_payments_by_order AS p
  ON oi.order_id = p.order_id;

DROP VIEW IF EXISTS v_order_items_missing_orders;
CREATE VIEW v_order_items_missing_orders AS
SELECT
  oi.*
FROM v_order_items_clean AS oi
LEFT JOIN v_orders_clean AS o
  ON oi.order_id = o.order_id
WHERE o.order_id IS NULL;

DROP VIEW IF EXISTS v_order_items_missing_payments;
CREATE VIEW v_order_items_missing_payments AS
SELECT
  oi.*
FROM v_order_items_clean AS oi
LEFT JOIN v_payments_by_order AS p
  ON oi.order_id = p.order_id
WHERE p.order_id IS NULL;

DROP VIEW IF EXISTS v_payments_without_orders;
CREATE VIEW v_payments_without_orders AS
SELECT
  p.*
FROM v_payments_clean AS p
LEFT JOIN v_orders_clean AS o
  ON p.order_id = o.order_id
WHERE o.order_id IS NULL;

DROP VIEW IF EXISTS v_orders_with_multiple_items;
CREATE VIEW v_orders_with_multiple_items AS
SELECT
  oi.order_id,
  oi.order_id_normalized,
  COUNT(*) AS item_row_count,
  SUM(COALESCE(oi.quantity, 0)) AS total_item_quantity
FROM v_order_items_clean AS oi
GROUP BY oi.order_id, oi.order_id_normalized
HAVING COUNT(*) > 1;

DROP VIEW IF EXISTS v_orders_with_multiple_payments;
CREATE VIEW v_orders_with_multiple_payments AS
SELECT
  p.order_id,
  p.order_id_normalized,
  COUNT(*) AS payment_row_count,
  SUM(COALESCE(p.gross_amount, 0)) AS total_payment_gross_amount
FROM v_payments_clean AS p
GROUP BY p.order_id, p.order_id_normalized
HAVING COUNT(*) > 1;

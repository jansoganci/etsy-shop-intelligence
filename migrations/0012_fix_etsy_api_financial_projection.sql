-- Migration number: 0012
-- Phase 1 correctness fix for the Etsy API financial projection.
-- See docs/archive/etsy-api-financial-data-flow-audit.md.
--
-- 1. Persist Payment top-level currency fields (additive; CSV path untouched).
-- 2. Stop deriving Gross Sales from `grandtotal` (already net of discount, plus
--    tax/shipping); use `total_price` (pre-discount list value) instead, matching
--    the semantics the CSV path has always used.
-- 3. Stop copying payment_currency into listing_currency; derive listing_currency
--    from the receipt's transactions, only when they share a single currency.

ALTER TABLE etsy_api_payments ADD COLUMN currency TEXT;
ALTER TABLE etsy_api_payments ADD COLUMN shop_currency TEXT;
ALTER TABLE etsy_api_payments ADD COLUMN buyer_currency TEXT;

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
  r.total_price_currency AS order_currency,
  CASE WHEN r.total_price_divisor > 0
    THEN r.total_price_amount * 1.0 / r.total_price_divisor END AS order_value,
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
  COALESCE(p.currency, p.amount_gross_currency) AS payment_currency,
  NULL AS listing_amount,
  (
    SELECT CASE WHEN COUNT(DISTINCT t.price_currency) = 1 THEN MIN(t.price_currency) END
    FROM etsy_api_transactions t
    WHERE t.receipt_id = p.receipt_id
  ) AS listing_currency,
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
  'etsy_api' AS data_source,
  p.shop_currency,
  p.buyer_currency
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
SELECT pc.*, 'csv_upload' AS data_source, NULL AS shop_currency, NULL AS buyer_currency
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

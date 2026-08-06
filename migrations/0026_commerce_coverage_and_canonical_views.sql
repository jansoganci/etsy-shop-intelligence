-- Migration number: 0026
-- Phase 2 Commerce Sync: period coverage table + canonical view transition.
-- Additive only. No DROP TABLE, no DROP COLUMN, no data rewrite.
-- P1 owns etsy_sync_jobs period columns in 0025 — do not ALTER them here.
--
-- Views: stop gating on etsy_sync_resources + etsy_financial_cutover_settings.
-- Prefer API rows when the matching etsy_api_* row exists; enrich CSV-only
-- fields from the CSV tables; keep CSV fallback for API-absent rows.
-- Column ordinals must match v_*_clean / SELECT * CSV branches (0005 / 0014).

-- 1. Coverage: exactly one current row per requested window.
CREATE TABLE IF NOT EXISTS etsy_commerce_period_coverage (
  shop_id                  TEXT    NOT NULL,
  from_ts                  INTEGER NOT NULL,   -- inclusive
  to_ts                    INTEGER NOT NULL,   -- exclusive
  last_run_id              TEXT    NOT NULL,
  status                   TEXT    NOT NULL,   -- 'running'|'complete'|'partial'|'failed'
  etsy_receipt_count       INTEGER,
  persisted_receipt_count  INTEGER,
  payment_parents_selected INTEGER,
  payment_parents_checked  INTEGER,
  ledger_complete          INTEGER NOT NULL DEFAULT 0,
  first_synced_at          TEXT,
  last_refreshed_at        TEXT,
  error_code               TEXT,
  error_message            TEXT,
  created_at               TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id, from_ts, to_ts)
);

CREATE INDEX IF NOT EXISTS idx_commerce_coverage_recent
  ON etsy_commerce_period_coverage(shop_id, from_ts DESC);

-- 2. Canonical views: API row existence + CSV enrichment.
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
  (SELECT o2.coupon_code FROM orders o2 WHERE o2.order_id = r.receipt_id) AS coupon_code,
  (SELECT o2.coupon_details FROM orders o2 WHERE o2.order_id = r.receipt_id) AS coupon_details,
  CASE WHEN r.discount_amt_divisor > 0
        AND (
          r.discount_amt_currency IS NULL
          OR r.total_price_currency IS NULL
          OR r.discount_amt_currency = r.total_price_currency
        )
    THEN r.discount_amt_amount * 1.0 / r.discount_amt_divisor END AS discount_amount,
  (SELECT o2.shipping_discount FROM orders o2 WHERE o2.order_id = r.receipt_id) AS shipping_discount,
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
  (SELECT o2.import_id FROM orders o2 WHERE o2.order_id = r.receipt_id) AS import_id,
  r.synced_at AS created_at,
  r.synced_at AS updated_at,
  -- 1 when discount Money disagreed with total_price currency (discount_amount is
  -- NULL). Consumers must not COALESCE that NULL to 0 for gross sales.
  CASE WHEN r.discount_amt_divisor > 0
        AND r.discount_amt_currency IS NOT NULL
        AND r.total_price_currency IS NOT NULL
        AND r.discount_amt_currency <> r.total_price_currency
    THEN 1 ELSE 0 END AS discount_withheld,
  CASE WHEN EXISTS (SELECT 1 FROM orders o3 WHERE o3.order_id = r.receipt_id)
       THEN 'etsy_api+csv' ELSE 'etsy_api' END AS data_source
FROM etsy_api_receipts r
UNION ALL
SELECT o.*, 0 AS discount_withheld, 'csv_upload' AS data_source
FROM v_orders_clean o
WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts r WHERE r.receipt_id = o.order_id);

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
  (SELECT oi2.coupon_code FROM order_items oi2 WHERE oi2.transaction_id = t.transaction_id) AS coupon_code,
  (SELECT oi2.coupon_details FROM order_items oi2 WHERE oi2.transaction_id = t.transaction_id) AS coupon_details,
  CASE
    WHEN r.discount_amt_divisor > 0
      AND r.discount_amt_currency = t.price_currency
      AND t.price_divisor > 0
      AND (
        SELECT COUNT(DISTINCT t3.price_currency)
        FROM etsy_api_transactions t3
        WHERE t3.receipt_id = t.receipt_id
      ) = 1
      AND (
        SELECT SUM(t2.price_amount * t2.quantity * 1.0 / NULLIF(t2.price_divisor, 0))
        FROM etsy_api_transactions t2
        WHERE t2.receipt_id = t.receipt_id
          AND t2.price_currency = t.price_currency
      ) > 0
    THEN
      (r.discount_amt_amount * 1.0 / r.discount_amt_divisor)
      * (t.price_amount * t.quantity * 1.0 / t.price_divisor)
      / (
        SELECT SUM(t2.price_amount * t2.quantity * 1.0 / NULLIF(t2.price_divisor, 0))
        FROM etsy_api_transactions t2
        WHERE t2.receipt_id = t.receipt_id
          AND t2.price_currency = t.price_currency
      )
  END AS discount_amount,
  (SELECT oi2.shipping_discount FROM order_items oi2 WHERE oi2.transaction_id = t.transaction_id) AS shipping_discount,
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
  (SELECT oi2.vat_paid_by_buyer FROM order_items oi2 WHERE oi2.transaction_id = t.transaction_id) AS vat_paid_by_buyer,
  t.sku,
  (SELECT oi2.import_id FROM order_items oi2 WHERE oi2.transaction_id = t.transaction_id) AS import_id,
  t.synced_at AS created_at,
  t.synced_at AS updated_at,
  CASE WHEN EXISTS (SELECT 1 FROM order_items oi3 WHERE oi3.transaction_id = t.transaction_id)
       THEN 'etsy_api+csv' ELSE 'etsy_api' END AS data_source
FROM etsy_api_transactions t
JOIN etsy_api_receipts r ON r.receipt_id = t.receipt_id
LEFT JOIN etsy_api_listings l ON l.listing_id = t.listing_id
UNION ALL
SELECT oi.*, 'csv_upload' AS data_source
FROM v_order_items_clean oi
WHERE NOT EXISTS (
  SELECT 1 FROM etsy_api_transactions t WHERE t.transaction_id = oi.transaction_id
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
  -- Money currency authority: never use top-level Payment.currency for amounts.
  -- Emit payment_currency only when amount_* agree AND every present posted_* /
  -- adjusted_* Money field uses that same currency (absent fields are ignored).
  CASE WHEN p.amount_gross_currency = p.amount_fees_currency
        AND p.amount_gross_currency = p.amount_net_currency
        AND (p.posted_gross IS NULL OR p.posted_gross_currency = p.amount_gross_currency)
        AND (p.posted_fees IS NULL OR p.posted_fees_currency = p.amount_gross_currency)
        AND (p.posted_net IS NULL OR p.posted_net_currency = p.amount_gross_currency)
        AND (p.adjusted_gross IS NULL OR p.adjusted_gross_currency = p.amount_gross_currency)
        AND (p.adjusted_fees IS NULL OR p.adjusted_fees_currency = p.amount_gross_currency)
        AND (p.adjusted_net IS NULL OR p.adjusted_net_currency = p.amount_gross_currency)
       THEN p.amount_gross_currency END AS payment_currency,
  (
    SELECT CASE WHEN COUNT(DISTINCT t.price_currency) = 1
      THEN SUM(t.price_amount * 1.0 / t.price_divisor * t.quantity) END
    FROM etsy_api_transactions t
    WHERE t.receipt_id = p.receipt_id
  ) AS listing_amount,
  -- listing_currency is an FX-pair signal for TRY→USD CSV rates only; it never
  -- governs Money amounts (payment_currency does).
  (
    SELECT CASE WHEN COUNT(DISTINCT t.price_currency) = 1 THEN MIN(t.price_currency) END
    FROM etsy_api_transactions t
    WHERE t.receipt_id = p.receipt_id
  ) AS listing_currency,
  (SELECT csv.exchange_rate FROM payments csv WHERE csv.payment_id = p.payment_id) AS exchange_rate,
  (SELECT csv.vat_amount FROM payments csv WHERE csv.payment_id = p.payment_id) AS vat_amount,
  (SELECT csv.gift_card_applied FROM payments csv WHERE csv.payment_id = p.payment_id) AS gift_card_applied,
  p.status AS payment_status,
  'online' AS order_type,
  p.payment_method AS payment_type,
  (
    SELECT CASE
      WHEN COUNT(*) = 0 THEN 0
      -- Adjustments have no currency column; only trust fixed /100 when the
      -- parent Money currency is USD (probe: Payment.currency may be TRY).
      WHEN UPPER(p.amount_gross_currency) <> 'USD'
        OR p.amount_gross_currency IS NULL
        OR p.amount_gross_currency <> p.amount_fees_currency
        OR p.amount_gross_currency <> p.amount_net_currency
        THEN NULL
      WHEN SUM(CASE WHEN pa.total_adjustment_amount IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
      ELSE SUM(pa.total_adjustment_amount) * 1.0 / 100
    END
    FROM etsy_api_payment_adjustments pa
    WHERE pa.payment_id = p.payment_id AND pa.is_success = 1
  ) AS refund_amount,
  (SELECT csv.import_id FROM payments csv WHERE csv.payment_id = p.payment_id) AS import_id,
  p.synced_at AS created_at,
  p.synced_at AS updated_at,
  CASE WHEN EXISTS (SELECT 1 FROM payments csv WHERE csv.payment_id = p.payment_id)
       THEN 'etsy_api+csv' ELSE 'etsy_api' END AS data_source,
  p.shop_currency,
  p.buyer_currency
FROM etsy_api_payments p
UNION ALL
SELECT pc.*, 'csv_upload' AS data_source, NULL AS shop_currency, NULL AS buyer_currency
FROM v_payments_clean pc
WHERE NOT EXISTS (
  SELECT 1 FROM etsy_api_payments p WHERE p.payment_id = pc.payment_id
);

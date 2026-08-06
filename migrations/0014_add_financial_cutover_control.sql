-- Migration number: 0014
-- Financial Phase 3: explicit, off-by-default control over whether the
-- canonical financial views prefer API rows once the relevant sync resource
-- completes. Additive only -- no drops, no CSV removal.
-- See docs/archive/etsy-api-financial-data-flow-audit.md (Faz 1/2: migrations
-- 0012/0013) and docs/etsy-reconciliation-development-plan.md (which this
-- migration's companion endpoint reads from, rather than re-deriving).
--
-- Before this migration, v_orders_canonical / v_order_items_canonical /
-- v_payments_canonical began shadowing CSV rows with API rows the instant
-- the relevant sync resource reached status='completed' -- automatically,
-- with no human confirmation and no regard for reconciliation results. That
-- is exactly the "premature cutover" risk the audit and reconciliation plan
-- both flag. This migration adds an explicit switch, defaulted off (no row
-- for a shop = off), so completing a sync no longer silently changes what
-- number the dashboard shows. Enabling it is a separate, deliberate action
-- (see functions/api/data-center/financial-cutover.ts).

CREATE TABLE IF NOT EXISTS etsy_financial_cutover_settings (
  shop_id TEXT PRIMARY KEY,
  orders_api_first INTEGER NOT NULL DEFAULT 0,
  payments_api_first INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A connected shop exists before the optional shop-profile sync has run.
  -- Cutover ownership therefore follows the OAuth connection, not the
  -- derived API shop cache; otherwise a valid connected shop can hit a
  -- foreign-key failure when saving its first cutover setting.
  FOREIGN KEY (shop_id) REFERENCES etsy_connections(shop_id) ON DELETE CASCADE
);

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
AND EXISTS (
  SELECT 1 FROM etsy_financial_cutover_settings s
  WHERE s.shop_id = r.shop_id AND s.orders_api_first = 1
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
    AND EXISTS (
      SELECT 1 FROM etsy_financial_cutover_settings s
      WHERE s.shop_id = r.shop_id AND s.orders_api_first = 1
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
  -- Receipt discount is order-grain. Allocate it by item gross value so the
  -- item rows sum back to the receipt discount instead of multiplying the
  -- full discount once per transaction. Mixed/mismatched currencies remain
  -- unavailable rather than being combined.
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
AND EXISTS (
  SELECT 1 FROM etsy_financial_cutover_settings s
  WHERE s.shop_id = r.shop_id AND s.orders_api_first = 1
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
    AND EXISTS (
      SELECT 1 FROM etsy_financial_cutover_settings s
      WHERE s.shop_id = r.shop_id AND s.orders_api_first = 1
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
  (
    SELECT CASE WHEN COUNT(DISTINCT t.price_currency) = 1
      THEN SUM(t.price_amount * 1.0 / t.price_divisor * t.quantity) END
    FROM etsy_api_transactions t
    WHERE t.receipt_id = p.receipt_id
  ) AS listing_amount,
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
  (
    SELECT CASE
      WHEN COUNT(*) = 0 THEN 0
      WHEN SUM(CASE WHEN pa.total_adjustment_amount IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
      ELSE SUM(pa.total_adjustment_amount) * 1.0 / 100
    END
    FROM etsy_api_payment_adjustments pa
    WHERE pa.payment_id = p.payment_id AND pa.is_success = 1
  ) AS refund_amount,
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
AND EXISTS (
  SELECT 1 FROM etsy_financial_cutover_settings s
  WHERE s.shop_id = p.shop_id AND s.payments_api_first = 1
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
    AND EXISTS (
      SELECT 1 FROM etsy_financial_cutover_settings s
      WHERE s.shop_id = p.shop_id AND s.payments_api_first = 1
    )
);

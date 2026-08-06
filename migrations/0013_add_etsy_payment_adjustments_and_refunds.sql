-- Migration number: 0013
-- Phase 2: normalize Etsy payment adjustments (refunds) and receipt-level
-- refunds into the canonical financial model. Additive only.
-- See docs/archive/etsy-api-financial-data-flow-audit.md and Phase 1 (migration 0012).
--
-- Etsy schema reference (confirmed against the live OpenAPI spec):
--   Payment.payment_adjustments[] -> PaymentAdjustment -> payment_adjustment_items[] -> PaymentAdjustmentItem
--   ShopReceipt.refunds[] -> ShopRefund (no unique ID on this object)
--
-- PaymentAdjustment/PaymentAdjustmentItem monetary fields are plain integers,
-- not Money objects (no explicit divisor). Etsy's schema states amounts on
-- this object family are "in USD pennies unless otherwise specified," so a
-- fixed divisor of 100 is applied when these are projected into the view
-- below -- this is the documented unit convention, not an invented rate.

CREATE TABLE IF NOT EXISTS etsy_api_payment_adjustments (
  payment_adjustment_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  status TEXT,
  is_success INTEGER,
  user_id TEXT,
  reason_code TEXT,
  total_adjustment_amount INTEGER,
  shop_total_adjustment_amount INTEGER,
  buyer_total_adjustment_amount INTEGER,
  total_fee_adjustment_amount INTEGER,
  create_timestamp INTEGER,
  update_timestamp INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES etsy_api_payments(payment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_payment_adjustments_payment_id
  ON etsy_api_payment_adjustments(payment_id);

CREATE TABLE IF NOT EXISTS etsy_api_payment_adjustment_items (
  payment_adjustment_item_id TEXT PRIMARY KEY,
  payment_adjustment_id TEXT NOT NULL,
  adjustment_type TEXT,
  amount INTEGER,
  shop_amount INTEGER,
  transaction_id TEXT,
  bill_payment_id TEXT,
  created_timestamp INTEGER,
  updated_timestamp INTEGER,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (payment_adjustment_id)
    REFERENCES etsy_api_payment_adjustments(payment_adjustment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_payment_adjustment_items_adjustment_id
  ON etsy_api_payment_adjustment_items(payment_adjustment_id);
CREATE INDEX IF NOT EXISTS idx_etsy_api_payment_adjustment_items_transaction_id
  ON etsy_api_payment_adjustment_items(transaction_id);

-- ShopRefund has no unique ID in Etsy's schema, so rows are replaced wholesale
-- per receipt on every sync (see upsertReceipt) rather than upserted by key.
CREATE TABLE IF NOT EXISTS etsy_api_receipt_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id TEXT NOT NULL,
  amount INTEGER,
  amount_divisor INTEGER,
  amount_currency TEXT,
  created_timestamp INTEGER,
  reason TEXT,
  note_from_issuer TEXT,
  status TEXT,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES etsy_api_receipts(receipt_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_etsy_api_receipt_refunds_receipt_id
  ON etsy_api_receipt_refunds(receipt_id);

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
    -- No successful adjustment rows at all => a confirmed zero refund, not a
    -- missing value. A successful row with a NULL amount => genuinely
    -- unavailable, so the whole total is left NULL rather than silently
    -- summing only the rows that happen to have an amount.
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

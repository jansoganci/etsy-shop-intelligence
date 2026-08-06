-- Migration number: 0031
-- Exposes `sequence_number` on v_ledger_canonical. One column, nothing else.
--
-- WHY. The view's documented invariant is that a period's summed amount_try
-- equals the balance it moved through. Many ledger entries share the same
-- create_timestamp, and the running `balance` only makes sense ordered by
-- (create_timestamp, sequence_number). Without the column a consumer breaks
-- ties arbitrarily and reads the wrong opening or closing balance.
--
-- This was caught while verifying migration 0030 on production: a check that
-- broke ties on entry_id reported 7.47 and 8.59 TRY of drift for 2026-03 and
-- 2026-01. Ordered by sequence_number the same check returns 0 for every month,
-- and the full-table chain (`previous balance + amount = balance`) holds for
-- all 10,502 rows. The data was always right; the ordering key was missing.

DROP VIEW IF EXISTS v_ledger_canonical;
CREATE VIEW v_ledger_canonical AS
SELECT
  l.entry_id,
  l.shop_id,
  l.create_timestamp,
  -- Ties on create_timestamp are common; the balance chain only orders
  -- correctly with sequence_number, so consumers need it exposed.
  l.sequence_number,
  date(l.create_timestamp, 'unixepoch') AS entry_date,
  l.ledger_type,
  l.reference_type,
  l.reference_id,
  l.currency AS entry_currency,
  -- Etsy ledger amounts are minor units of l.currency. There is no divisor
  -- column on this table; /100 is the documented convention (migration 0010).
  l.amount * 1.0 / 100 AS amount_try,
  l.balance * 1.0 / 100 AS balance_try,
  -- Category is keyed on ledger_type. All 31 types observed in production are
  -- mapped; anything new falls through to 'other' so a row can never vanish
  -- silently from a total.
  CASE l.ledger_type
    WHEN 'PAYMENT_GROSS' THEN 'sales_gross'
    WHEN 'REFUND_GROSS' THEN 'refund'
    WHEN 'sales_tax' THEN 'tax_remitted'
    WHEN 'vat_tax_ep' THEN 'tax_remitted'
    WHEN 'VAT_REFUND_EP' THEN 'tax_remitted'
    WHEN 'PAYMENT_PROCESSING_FEE' THEN 'fee_processing'
    WHEN 'REFUND_PROCESSING_FEE' THEN 'fee_processing'
    WHEN 'transaction' THEN 'fee_transaction'
    WHEN 'transaction_refund' THEN 'fee_transaction'
    WHEN 'regulatory_operating_fee' THEN 'fee_regulatory'
    WHEN 'regulatory_operating_fee_refund' THEN 'fee_regulatory'
    WHEN 'vat_seller_services' THEN 'fee_vat'
    WHEN 'vat_seller_services_refund' THEN 'fee_vat'
    WHEN 'vat_on_processing_fees' THEN 'fee_vat'
    WHEN 'renew_sold_auto' THEN 'fee_listing'
    WHEN 'renew_sold_auto_refund' THEN 'fee_listing'
    WHEN 'renew_sold' THEN 'fee_listing'
    WHEN 'listing' THEN 'fee_listing'
    WHEN 'listing_refund' THEN 'fee_listing'
    WHEN 'auto_renew_expired' THEN 'fee_listing'
    WHEN 'renew' THEN 'fee_listing'
    WHEN 'renew_expired' THEN 'fee_listing'
    WHEN 'prolist' THEN 'ads'
    WHEN 'prolist_refund' THEN 'ads'
    WHEN 'offsite_ads_fee' THEN 'ads'
    WHEN 'seller_credit' THEN 'credit'
    WHEN 'SELLER_DRIVEN_TRAFFIC_CREDIT' THEN 'credit'
    WHEN 'seller_onboarding_fee' THEN 'onboarding'
    WHEN 'seller_onboarding_fee_payment' THEN 'onboarding'
    WHEN 'DISBURSE2' THEN 'disbursement'
    WHEN 'billing_payment' THEN 'funding'
    ELSE 'other'
  END AS category
FROM etsy_api_ledger_entries l;

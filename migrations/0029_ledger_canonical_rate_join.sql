-- Migration number: 0029
-- Performance fix for v_ledger_canonical (migration 0028). Same numbers, same
-- columns, same rules — only how the daily rate is looked up changes.
--
-- WHY. 0028 resolved the carried-forward rate with a correlated subquery
-- repeated three times per row (rate, the `> 0` gate, and the division). Each
-- one re-ran `v_ledger_daily_rate`, itself an aggregate over
-- etsy_api_payments JOIN etsy_api_receipts. Measured on production:
--
--   one month of v_ledger_canonical  -> 9,238,583 rows read, 4.8 s
--   the whole view                   -> "D1 DB exceeded its CPU time limit"
--
-- 10,502 ledger rows x 3 subqueries x ~971 payments is ~30M row reads. The view
-- was correct but unusable, and Stage 2 needs to query it per period.
--
-- FIX. Resolve the carry-forward once per DISTINCT ledger day (~500 days, not
-- 10,502 rows x 3), then join that in. `v_ledger_entry_rate` is the new
-- indirection; `v_ledger_canonical` reads its rate from the joined column, so
-- the three references cost nothing.
--
-- v_ledger_daily_rate is unchanged and intentionally re-declared here so this
-- file is self-contained when replayed from scratch by FullSchemaTestD1.

DROP VIEW IF EXISTS v_ledger_canonical;
DROP VIEW IF EXISTS v_ledger_entry_rate;
DROP VIEW IF EXISTS v_ledger_daily_rate;

-- One TRY->USD rate per day, from Etsy's own figures: settlement gross over the
-- receipt's USD grandtotal, the same construction migration 0027 uses per
-- payment. The `amount_gross_divisor = 100` filter is load-bearing — payment
-- 204718752729 (buyer currency IDR) carries divisor 1 and would skew its day's
-- rate by 100x.
CREATE VIEW v_ledger_daily_rate AS
SELECT
  date(p.create_timestamp, 'unixepoch') AS rate_date,
  SUM(p.amount_gross * 1.0 / p.amount_gross_divisor)
    / SUM(r.grandtotal_amount * 1.0 / r.grandtotal_divisor) AS settlement_per_usd
FROM etsy_api_payments p
JOIN etsy_api_receipts r ON r.receipt_id = p.receipt_id
WHERE p.amount_gross_divisor = 100
  AND p.amount_gross > 0
  AND r.grandtotal_divisor > 0
  AND r.grandtotal_amount > 0
  AND UPPER(r.grandtotal_currency) = 'USD'
GROUP BY 1;

-- The rate that applies to each day the ledger actually has entries on: that
-- day's own rate, else the most recent earlier day that had one. Advertising is
-- charged daily but some days have no sale (6 of 31 in 2026-05), so the
-- carry-forward is required. TRY moves ~0.1%/day, so a one-to-three day carry
-- costs cents. Days before the first payment get NULL — no rate is ever
-- extrapolated backwards.
CREATE VIEW v_ledger_entry_rate AS
SELECT
  d.entry_date,
  (
    SELECT dr.settlement_per_usd
    FROM v_ledger_daily_rate dr
    WHERE dr.rate_date <= d.entry_date
    ORDER BY dr.rate_date DESC
    LIMIT 1
  ) AS settlement_per_usd
FROM (
  SELECT DISTINCT date(create_timestamp, 'unixepoch') AS entry_date
  FROM etsy_api_ledger_entries
) d;

-- One row per ledger entry, categorised and USD-converted.
--
-- True Net for a period:
--   SUM(amount_usd) WHERE category NOT IN ('disbursement', 'funding')
--
-- `disbursement` is money moving to the bank and `funding` is the owner topping
-- the Etsy balance up by card — neither is income or cost. Everything else is.
--
-- Self-checking invariant for consumers:
--   SUM(amount_try) over a period == closing balance - opening balance
CREATE VIEW v_ledger_canonical AS
SELECT
  l.entry_id,
  l.shop_id,
  l.create_timestamp,
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
  END AS category,
  er.settlement_per_usd AS exchange_rate,
  -- The rate converts TRY only. A non-TRY entry stays unavailable rather than
  -- being divided by a TRY rate — the same rule migration 0027 established.
  CASE
    WHEN UPPER(l.currency) = 'TRY'
     AND l.amount IS NOT NULL
     AND er.settlement_per_usd > 0
    THEN (l.amount * 1.0 / 100) / er.settlement_per_usd
  END AS amount_usd
FROM etsy_api_ledger_entries l
LEFT JOIN v_ledger_entry_rate er
  ON er.entry_date = date(l.create_timestamp, 'unixepoch');

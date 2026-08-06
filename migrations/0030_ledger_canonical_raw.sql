-- Migration number: 0030
-- Moves the ledger's USD conversion out of SQL and into TypeScript, matching
-- how payments are already handled. Same rules, same numbers — different layer.
--
-- WHY. Migrations 0028 and 0029 resolved the carried-forward daily rate inside
-- the view. SQLite inlines a view rather than materialising it, so the
-- `ORDER BY rate_date DESC LIMIT 1` carry-forward re-ran per ledger row, and
-- with it the aggregate over etsy_api_payments JOIN etsy_api_receipts.
-- Measured on production, one month of v_ledger_canonical:
--
--   0028 (3 correlated subqueries)  9,238,583 rows read, 4.8 s
--   0029 (joined through a view)   9,250,998 rows read, 5.3 s
--   v_ledger_daily_rate alone           2,914 rows read, 2 ms
--
-- The rate itself is cheap (401 days); resolving it per row is what is not.
-- The join in 0029 did not help because the view was inlined back into the
-- correlated form.
--
-- FIX. The view now emits only raw, cheap columns: entry date, category and
-- the TRY amount. Consumers read the 401-row `v_ledger_daily_rate` once and
-- carry it forward in TypeScript — see `summarizeLedger` in
-- `functions/api/intelligence/_ledger.ts`. This mirrors
-- `summarizePaymentFinancials` in `functions/api/intelligence/_financials.ts`,
-- which already converts payment rows in TypeScript rather than SQL, and it
-- makes the conversion rules (carry-forward, non-TRY stays unavailable) unit
-- testable instead of buried in a view.
--
-- v_ledger_daily_rate keeps its 0029 definition and is re-declared so this file
-- replays standalone. v_ledger_entry_rate is dropped — it exists only to serve
-- the per-row lookup that is going away.

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

-- One row per ledger entry: raw TRY amount plus the category that decides how
-- it is treated. No currency conversion here — see the module comment above.
--
-- True Net for a period, computed by the caller:
--   SUM(usd) over categories other than 'disbursement' and 'funding'.
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
  END AS category
FROM etsy_api_ledger_entries l;

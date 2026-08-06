-- Migration number: 0027
-- Corrects the currency authority for Etsy API payment Money amounts.
--
-- WHY (measured against production D1 on 2026-08-06, 971 API payments):
--
--   etsy_api_payments.currency        = 'TRY' on 971 / 971 rows
--   etsy_api_payments.amount_*_currency == buyer_currency on 971 / 971 rows
--                                         (18 distinct buyer currencies, no exception)
--
-- Etsy reports this shop's payment Money amounts in the SETTLEMENT currency
-- (TRY, minor units), but stamps `currency_code` — and `divisor` — from the
-- BUYER's currency. `amount_gross_currency` is therefore a buyer-currency
-- label, not the currency of the amount. Migration 0026 made it the currency
-- authority, which is exactly inverted.
--
-- Proof against the July 2026 Etsy CSV export (30 payments, 0 deviations):
--   D1 amount_fees == CSV "Fees"        (TRY)  30/30
--   D1 amount_net  == CSV "Net Amount"  (TRY)  30/30
--   D1 amount_gross == CSV "Gross Amount" + buyer tax (TRY)  30/30
-- e.g. receipt 4114056691 sold for USD 12.54; amount_gross = 574.46, labelled
-- 'USD'. 574.46 TRY / 45.809887 = 12.54 USD.
--
-- IMPACT BEFORE THIS FIX: a period whose buyers all happened to pay in USD had
-- every row labelled 'USD', took the identity branch in
-- functions/api/intelligence/_financials.ts (rate = 1), and published TRY as
-- dollars — roughly 46x too high, with no warning. 2026-08 was live in that
-- state (Etsy Fees $54.66 / Net Sales $355.50 against $8.85 of gross sales).
-- Periods with at least one foreign buyer were saved only by accident: the
-- foreign label failed validation and closed the whole period.
--
-- THIS MIGRATION CHANGES THREE EXPRESSIONS IN v_payments_canonical. No table,
-- column, index or row is touched, and the CSV branch is untouched.
--
-- 1. payment_currency  -> p.currency (the settlement currency the amounts are
--    actually in). The per-field agreement gate from 0026 is kept: it no longer
--    proves a currency, but it still proves Etsy was internally consistent
--    about the row, so a self-contradicting row stays unavailable.
--
-- 2. exchange_rate     -> derived per payment from Etsy's own two figures for
--    the SAME payment:
--
--        rate = amount_gross (settlement minor units)
--             / etsy_api_receipts.grandtotal (USD, tax inclusive)
--
--    This is not an invented or averaged rate — both operands come from Etsy
--    for that one payment, so the quotient is that payment's own TRY/USD rate.
--    Validated against the CSV `exchange_rate` on all 939 payments that have
--    both: 938 agree within 0.1%. The single disagreement is receipt
--    4096271611 (buyer currency IDR), where Etsy returned divisor = 1 instead
--    of 100; because the same scale error appears in the numerator and in
--    every converted amount, the derived rate cancels it and yields the correct
--    USD 2.88. The CSV rate on that row yields USD 320.29 — 100x wrong. The
--    derived rate is therefore strictly safer than the CSV rate, and the CSV
--    rate is no longer consulted on the API branch.
--
--    Guarded: NULL unless the receipt exists, grandtotal is USD and positive,
--    and amount_gross is positive. A NULL rate keeps the row unavailable
--    rather than guessed, per the standing contract.
--
-- 3. gross_amount      -> amount_fees + amount_net (tax exclusive).
--    amount_gross includes the tax/VAT the buyer paid, which Etsy remits and
--    the seller never receives, so amount_gross - amount_fees - amount_net =
--    buyer tax. The CSV "Gross Amount" excludes that tax and satisfies
--    Gross = Fees + Net exactly (939/939 CSV rows). Emitting fees + net makes
--    the API branch use the CSV's definition, so the two sources are
--    comparable, and reconciliationDeltaUsd (_financials.ts) returns to 0
--    instead of reporting the tax as a reconciliation failure every period.
--    Verified: fees + net == CSV Gross on 937 / 939 rows to the cent. The two
--    exceptions are the IDR divisor row above and receipt 3612054929 (INR,
--    2025-02-24), where Etsy returned whole-TRY rounded Money — a USD 0.02
--    difference on one 2025 order.
--
-- Tax is still available: amount_gross - (amount_fees + amount_net), converted
-- at the same derived rate. No consumer needs it today, so no column is added.

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
  -- Tax-exclusive gross, matching the CSV "Gross Amount" definition. See (3).
  CASE WHEN p.amount_fees_divisor > 0 AND p.amount_net_divisor > 0
    THEN p.amount_fees * 1.0 / p.amount_fees_divisor
       + p.amount_net * 1.0 / p.amount_net_divisor END AS gross_amount,
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
  -- Money currency authority: the SETTLEMENT currency (Payment.currency), which
  -- is what Etsy denominates these amounts in for this shop. amount_*_currency
  -- is a buyer-currency label and must never govern an amount. See (1). The
  -- agreement gate is retained so a self-contradicting row stays unavailable.
  CASE WHEN p.amount_gross_currency = p.amount_fees_currency
        AND p.amount_gross_currency = p.amount_net_currency
        AND (p.posted_gross IS NULL OR p.posted_gross_currency = p.amount_gross_currency)
        AND (p.posted_fees IS NULL OR p.posted_fees_currency = p.amount_gross_currency)
        AND (p.posted_net IS NULL OR p.posted_net_currency = p.amount_gross_currency)
        AND (p.adjusted_gross IS NULL OR p.adjusted_gross_currency = p.amount_gross_currency)
        AND (p.adjusted_fees IS NULL OR p.adjusted_fees_currency = p.amount_gross_currency)
        AND (p.adjusted_net IS NULL OR p.adjusted_net_currency = p.amount_gross_currency)
       THEN p.currency END AS payment_currency,
  (
    SELECT CASE WHEN COUNT(DISTINCT t.price_currency) = 1
      THEN SUM(t.price_amount * 1.0 / t.price_divisor * t.quantity) END
    FROM etsy_api_transactions t
    WHERE t.receipt_id = p.receipt_id
  ) AS listing_amount,
  -- listing_currency is the FX-pair signal for the settlement -> USD rate; it
  -- never governs Money amounts (payment_currency does).
  (
    SELECT CASE WHEN COUNT(DISTINCT t.price_currency) = 1 THEN MIN(t.price_currency) END
    FROM etsy_api_transactions t
    WHERE t.receipt_id = p.receipt_id
  ) AS listing_currency,
  -- Derived per payment from Etsy's own settlement gross and USD grandtotal for
  -- the same payment. Not the CSV rate: see (2) for why the CSV rate is unsafe.
  (
    SELECT CASE
      WHEN r.grandtotal_divisor > 0
       AND r.grandtotal_amount > 0
       AND UPPER(r.grandtotal_currency) = 'USD'
       AND p.amount_gross_divisor > 0
       AND p.amount_gross > 0
      THEN (p.amount_gross * 1.0 / p.amount_gross_divisor)
         / (r.grandtotal_amount * 1.0 / r.grandtotal_divisor)
    END
    FROM etsy_api_receipts r
    WHERE r.receipt_id = p.receipt_id
  ) AS exchange_rate,
  (SELECT csv.vat_amount FROM payments csv WHERE csv.payment_id = p.payment_id) AS vat_amount,
  (SELECT csv.gift_card_applied FROM payments csv WHERE csv.payment_id = p.payment_id) AS gift_card_applied,
  p.status AS payment_status,
  'online' AS order_type,
  p.payment_method AS payment_type,
  (
    SELECT CASE
      WHEN COUNT(*) = 0 THEN 0
      -- Adjustments have no currency column; only trust the fixed /100 when the
      -- parent payment settles in USD. This shop settles in TRY, so adjustments
      -- stay unavailable rather than being summed into a USD total.
      WHEN UPPER(p.currency) <> 'USD' OR p.currency IS NULL THEN NULL
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

import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";
import { summarizePaymentFinancials, type PaymentFinancialRow } from "./_financials";

/**
 * Currency authority for Etsy API payment Money amounts.
 *
 * Measured against production D1 on 2026-08-06 (971 API payments, cross-checked
 * against the July 2026 Etsy CSV export):
 *
 *   etsy_api_payments.currency         = 'TRY' on 971 / 971 rows (settlement)
 *   etsy_api_payments.amount_*_currency == buyer_currency on 971 / 971 rows
 *
 * Etsy denominates the Money amounts in the SETTLEMENT currency but stamps
 * `currency_code` (and `divisor`) from the BUYER's currency. So
 * `amount_gross_currency` is a buyer label, never the currency of the amount.
 * `Payment.currency` is the authority; the USD figure comes from the receipt's
 * own USD grandtotal for the same payment.
 *
 * See migrations/0027_fix_payment_settlement_currency.sql for the full evidence.
 */

const SHOP_ID = "shop-1";
const SYNCED_AT = "2026-07-15T00:00:00Z";
const CREATE_TS = Math.floor(Date.UTC(2026, 6, 15) / 1000);

type PaymentShape = {
  /** Receipt USD minor units. grandTotal is tax inclusive, like Etsy's. */
  totalPrice?: number;
  grandTotal?: number;
  grandTotalCurrency?: string;
  /** Settlement Money, in minor units of the settlement currency. */
  gross: number;
  fees: number;
  net: number;
  /** Etsy's divisor. It follows the buyer currency, not the settlement one. */
  divisor?: number;
  /** Buyer-currency label Etsy stamps on every Money object. */
  moneyLabel?: string;
  /** Override to simulate a self-contradicting row. */
  feesLabel?: string;
  postedLabel?: string;
  settlementCurrency?: string;
};

function seedShop(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_shops (shop_id, user_id, shop_name, synced_at)
        VALUES (?, 'user-1', 'Test Shop', ?)
      `,
    )
    .run(SHOP_ID, SYNCED_AT);
}

function insertPayment(
  db: FullSchemaTestD1,
  paymentId: string,
  receiptId: string,
  shape: PaymentShape,
): void {
  const divisor = shape.divisor ?? 100;
  const label = shape.moneyLabel ?? "USD";
  const feesLabel = shape.feesLabel ?? label;
  const postedLabel = shape.postedLabel ?? label;
  const settlement = shape.settlementCurrency ?? "TRY";
  const totalPrice = shape.totalPrice ?? 940;
  const grandTotal = shape.grandTotal ?? totalPrice;

  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, buyer_hash, status, create_timestamp,
          total_price_amount, total_price_divisor, total_price_currency,
          grandtotal_amount, grandtotal_divisor, grandtotal_currency,
          synced_at
        ) VALUES (?, ?, 'buyer', 'paid', ?, ?, 100, 'USD', ?, 100, ?, ?)
      `,
    )
    .run(
      receiptId,
      SHOP_ID,
      CREATE_TS,
      totalPrice,
      grandTotal,
      shape.grandTotalCurrency ?? "USD",
      SYNCED_AT,
    );

  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_transactions (
          transaction_id, receipt_id, title, quantity,
          price_amount, price_divisor, price_currency, synced_at
        ) VALUES (?, ?, 'Pattern', 1, ?, 100, 'USD', ?)
      `,
    )
    .run(`${receiptId}-txn`, receiptId, totalPrice, SYNCED_AT);

  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_payments (
          payment_id, shop_id, receipt_id, status, payment_method,
          amount_gross, amount_gross_divisor, amount_gross_currency,
          amount_fees, amount_fees_divisor, amount_fees_currency,
          amount_net, amount_net_divisor, amount_net_currency,
          posted_gross, posted_gross_divisor, posted_gross_currency,
          posted_fees, posted_fees_divisor, posted_fees_currency,
          posted_net, posted_net_divisor, posted_net_currency,
          create_timestamp, synced_at, currency, shop_currency, buyer_currency
        ) VALUES (
          ?, ?, ?, 'SETTLED', 'cc',
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, 'USD', ?
        )
      `,
    )
    .run(
      paymentId,
      SHOP_ID,
      receiptId,
      shape.gross,
      divisor,
      label,
      shape.fees,
      divisor,
      feesLabel,
      shape.net,
      divisor,
      label,
      shape.gross,
      divisor,
      postedLabel,
      shape.fees,
      divisor,
      postedLabel,
      shape.net,
      divisor,
      postedLabel,
      CREATE_TS,
      SYNCED_AT,
      settlement,
      label,
    );
}

/** A CSV payments row whose exchange_rate must never be consulted on the API branch. */
function insertCsvPaymentRate(
  db: FullSchemaTestD1,
  paymentId: string,
  orderId: string,
  rate = 34,
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO payments (
          payment_id, order_id, order_date, currency, exchange_rate,
          gross_amount, fees, net_amount
        ) VALUES (?, ?, '2026-07-15', 'TRY', ?, 9.4, 1.5, 7.9)
      `,
    )
    .run(paymentId, orderId, rate);
}

type CanonicalPayment = {
  paymentCurrency: string | null;
  listingCurrency: string | null;
  exchangeRate: number | null;
  grossAmount: number | null;
  fees: number | null;
  netAmount: number | null;
  dataSource: string;
};

function loadCanonicalPayment(db: FullSchemaTestD1, paymentId: string) {
  return db.sqlite
    .prepare(
      `
        SELECT
          payment_currency AS paymentCurrency,
          listing_currency AS listingCurrency,
          exchange_rate AS exchangeRate,
          gross_amount AS grossAmount,
          fees,
          net_amount AS netAmount,
          data_source AS dataSource
        FROM v_payments_canonical
        WHERE payment_id = ?
      `,
    )
    .get<CanonicalPayment>(paymentId);
}

function summarize(view: CanonicalPayment, orderId: string) {
  const row: PaymentFinancialRow = {
    orderId,
    grossAmount: view.grossAmount,
    fees: view.fees,
    netAmount: view.netAmount,
    exchangeRate: view.exchangeRate,
    paymentCurrency: view.paymentCurrency,
    listingCurrency: view.listingCurrency,
    dataSource: view.dataSource,
  };
  return summarizePaymentFinancials([row]);
}

/** Same conversion rule as reconciliation loadPaymentMonths (API branch). */
function reconcileApiMonth(db: FullSchemaTestD1) {
  return db.sqlite
    .prepare(
      `
        SELECT
          SUM(gross_usd) AS gross,
          SUM(posted_gross_usd) AS postedGross,
          SUM(is_identity) AS identityCount,
          SUM(is_csv_rate) AS csvRateCount,
          SUM(CASE WHEN is_identity = 0 AND is_csv_rate = 0 THEN 1 ELSE 0 END) AS unconvertibleCount
        FROM (
          SELECT
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN gross_amount
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN gross_amount / exchange_rate
            END AS gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_gross
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN posted_gross / exchange_rate
            END AS posted_gross_usd,
            CASE WHEN UPPER(payment_currency) = 'USD' THEN 1 ELSE 0 END AS is_identity,
            CASE
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
              THEN 1 ELSE 0
            END AS is_csv_rate
          FROM v_payments_canonical
          WHERE data_source IN ('etsy_api', 'etsy_api+csv')
            AND order_date BETWEEN '2026-07-01' AND '2026-07-31'
        )
      `,
    )
    .get<{
      gross: number | null;
      postedGross: number | null;
      identityCount: number;
      csvRateCount: number;
      unconvertibleCount: number;
    }>();
}

describe("currency authority (settlement currency, not the buyer-currency label)", () => {
  it("1. USD-buyer row is TRY settlement, not $283.23 — the 2026-08 live defect", () => {
    // Production receipt 4134970319 / payment 207280043921: sold for USD 6.11,
    // settled as 283.23 TRY, every Money object labelled 'USD' by Etsy.
    // Under migration 0026 the label won and the dashboard published $283.23.
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      totalPrice: 940,
      grandTotal: 611,
      gross: 28323,
      fees: 3241,
      net: 25082,
      moneyLabel: "USD",
    });

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.paymentCurrency).toBe("TRY");
    expect(view.exchangeRate).toBeCloseTo(283.23 / 6.11, 6);

    const summary = summarize(view, "rcpt-1");
    expect(summary.valid).toBe(true);
    expect(summary.paymentGrossUsd).toBeCloseTo(6.11, 6);
    expect(summary.etsyFeesUsd).toBeCloseTo(0.6993, 3);
    expect(summary.netRevenueUsd).toBeCloseTo(5.4107, 3);
    // The defect this migration removes: TRY published as dollars.
    expect(summary.paymentGrossUsd).not.toBeCloseTo(283.23, 2);
  });

  it("2. Foreign-buyer row converts instead of closing the whole period", () => {
    // Production receipt 4105347821: USD 9.40 listing, USD 5.08 discount,
    // USD 0.86 VAT -> USD 5.18 grandtotal; settled 235.72 TRY, labelled 'GBP'.
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      totalPrice: 940,
      grandTotal: 518,
      gross: 23572,
      fees: 2932,
      net: 16726,
      moneyLabel: "GBP",
    });

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.paymentCurrency).toBe("TRY");
    expect(view.exchangeRate).toBeCloseTo(45.5058, 3);
    // Tax-exclusive gross == the CSV export's "Gross Amount" of 196.58 TRY.
    expect(view.grossAmount).toBeCloseTo(196.58, 6);

    const summary = summarize(view, "rcpt-1");
    expect(summary.valid).toBe(true);
    // 9.40 listing - 5.08 discount = 4.32 of gross sales.
    expect(summary.paymentGrossUsd).toBeCloseTo(4.32, 2);
    expect(summary.reconciliationDeltaUsd).toBeCloseTo(0, 8);
  });

  it("3. Gross excludes buyer tax, so gross - fees - net reconciles to 0", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      grandTotal: 518,
      gross: 23572, // tax inclusive, as Etsy reports it
      fees: 2932,
      net: 16726,
      moneyLabel: "GBP",
    });

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.grossAmount).toBeCloseTo(view.fees! + view.netAmount!, 8);
    expect(view.grossAmount).toBeLessThan(235.72);

    const summary = summarize(view, "rcpt-1");
    expect(summary.reconciliationDeltaUsd).toBeCloseTo(0, 8);
  });

  it("4. CSV exchange_rate is never consulted on the API branch", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      grandTotal: 611,
      gross: 28323,
      fees: 3241,
      net: 25082,
    });
    insertCsvPaymentRate(db, "pay-1", "rcpt-1", 34);

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.dataSource).toBe("etsy_api+csv");
    expect(view.exchangeRate).not.toBe(34);
    expect(view.exchangeRate).toBeCloseTo(283.23 / 6.11, 6);

    expect(summarize(view, "rcpt-1").paymentGrossUsd).toBeCloseTo(6.11, 6);
  });

  it("5. A wrong Etsy divisor cancels out, because the rate uses the same amount", () => {
    // Production payment 204718752729 (buyer currency IDR): Etsy returned
    // divisor 1 instead of 100. The CSV rate yields USD 320.29; the derived
    // rate yields the correct USD 2.88.
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      totalPrice: 640,
      grandTotal: 320,
      gross: 14492,
      fees: 2342,
      net: 10701,
      divisor: 1,
      moneyLabel: "IDR",
    });

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.exchangeRate).toBeCloseTo(14492 / 3.2, 6);

    const summary = summarize(view, "rcpt-1");
    expect(summary.valid).toBe(true);
    // CSV cross-check: 130.43 / 45.28875 = 2.8801
    expect(summary.paymentGrossUsd).toBeCloseTo(2.8801, 3);
    expect(summary.etsyFeesUsd).toBeCloseTo(0.5171, 3);
    expect(summary.netRevenueUsd).toBeCloseTo(2.363, 3);
    expect(summary.paymentGrossUsd).not.toBeCloseTo(320.29, 1);
  });

  it("6. No USD grandtotal → no rate → unavailable, never guessed", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      grandTotal: 611,
      grandTotalCurrency: "TRY",
      gross: 28323,
      fees: 3241,
      net: 25082,
    });

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.paymentCurrency).toBe("TRY");
    expect(view.exchangeRate).toBeNull();

    const summary = summarize(view, "rcpt-1");
    expect(summary.valid).toBe(false);
    expect(summary.invalidRowCount).toBe(1);
    expect(summary.paymentGrossUsd).toBeNull();
    expect(summary.etsyFeesUsd).toBeNull();
    expect(summary.netRevenueUsd).toBeNull();
  });

  it("7. A self-contradicting Money row stays unavailable", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      grandTotal: 611,
      gross: 28323,
      fees: 3241,
      net: 25082,
      moneyLabel: "USD",
      feesLabel: "GBP",
    });

    const view = loadCanonicalPayment(db, "pay-1")!;
    expect(view.paymentCurrency).toBeNull();
    expect(summarize(view, "rcpt-1").valid).toBe(false);
  });

  it("8. posted_* disagreeing with amount_* stays unavailable (§8.4)", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      grandTotal: 611,
      gross: 28323,
      fees: 3241,
      net: 25082,
      moneyLabel: "USD",
      postedLabel: "GBP",
    });

    const view = loadCanonicalPayment(db, "pay-1");
    expect(view?.paymentCurrency).toBeNull();

    const recon = reconcileApiMonth(db);
    expect(recon?.unconvertibleCount).toBe(1);
    expect(recon?.gross).toBeNull();
    expect(recon?.postedGross).toBeNull();
  });

  it("9. Reconciliation and reporting produce the same USD figure", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertPayment(db, "pay-1", "rcpt-1", {
      grandTotal: 611,
      gross: 28323,
      fees: 3241,
      net: 25082,
      moneyLabel: "USD",
    });
    insertCsvPaymentRate(db, "pay-1", "rcpt-1", 34);

    const view = loadCanonicalPayment(db, "pay-1")!;
    const reporting = summarize(view, "rcpt-1");
    const recon = reconcileApiMonth(db);

    expect(recon?.identityCount).toBe(0);
    expect(recon?.csvRateCount).toBe(1);
    expect(recon?.unconvertibleCount).toBe(0);
    expect(reporting.paymentGrossUsd).toBeCloseTo(6.11, 6);
    expect(recon?.gross).toBeCloseTo(reporting.paymentGrossUsd!, 8);
    // posted_* is tax inclusive and converts with the same rate.
    expect(recon?.postedGross).toBeCloseTo(6.11, 6);
  });
});

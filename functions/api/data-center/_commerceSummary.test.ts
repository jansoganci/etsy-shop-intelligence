import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";
import { loadCommerceSummary } from "./_commerceSummary";

const SHOP_ID = "shop-1";
const RUN_ID = "run-commerce-1";
const SYNCED_AT = "2026-07-01T00:00:00Z";
const JULY_15_TS = Math.floor(Date.UTC(2026, 6, 15) / 1000);
const FROM_TS = Math.floor(Date.UTC(2026, 6, 1) / 1000);
const TO_EXCLUSIVE_TS = Math.floor(Date.UTC(2026, 7, 1) / 1000);

function seedConnection(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_connections (
          shop_id, etsy_user_id, scopes_json,
          access_token_ciphertext, access_token_iv,
          refresh_token_ciphertext, refresh_token_iv,
          access_token_expires_at, status
        ) VALUES (?, ?, '[]', 'a', 'i', 'r', 'i', '2099-01-01', 'connected')
      `,
    )
    .run(SHOP_ID, "user-1");
}

function seedApiShop(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_shops (
          shop_id, user_id, shop_name, synced_at
        ) VALUES (?, ?, ?, ?)
      `,
    )
    .run(SHOP_ID, "user-1", "Test Shop", SYNCED_AT);
}

function insertCommerceJob(
  db: FullSchemaTestD1,
  opts: {
    runId?: string;
    status?: string;
    fromTs?: number;
    toExclusiveTs?: number;
    resourceFetched?: Array<{ resource: string; fetched: number }>;
  } = {},
): void {
  const runId = opts.runId ?? RUN_ID;
  const fromTs = opts.fromTs ?? FROM_TS;
  const toExclusiveTs = opts.toExclusiveTs ?? TO_EXCLUSIVE_TS;

  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_sync_jobs (
          id, shop_id, requested_resource, status,
          period_from_ts, period_to_ts, is_period_run
        ) VALUES (?, ?, 'commerce', ?, ?, ?, 1)
      `,
    )
    .run(runId, SHOP_ID, opts.status ?? "completed", fromTs, toExclusiveTs);

  const resources = opts.resourceFetched ?? [
    { resource: "receipts", fetched: 100 },
    { resource: "payments", fetched: 50 },
    { resource: "ledger_entries", fetched: 12 },
  ];

  resources.forEach((entry, index) => {
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_sync_job_resources (
            run_id, resource, adapter_version, ordinal, status, fetched_count
          ) VALUES (?, ?, 1, ?, 'completed', ?)
        `,
      )
      .run(runId, entry.resource, index + 1, entry.fetched);
  });
}

function insertApiReceipt(
  db: FullSchemaTestD1,
  receiptId: string,
  opts: {
    createTimestamp?: number;
    totalPriceAmount?: number;
    discountAmount?: number;
    discountCurrency?: string;
    totalPriceCurrency?: string;
    /** Tax-inclusive USD total the buyer paid. Defaults to price - discount. */
    grandTotalAmount?: number;
    status?: string;
  } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, buyer_hash, city, country_iso, status, payment_method,
          create_timestamp, total_price_amount, total_price_divisor, total_price_currency,
          discount_amt_amount, discount_amt_divisor, discount_amt_currency,
          grandtotal_amount, grandtotal_divisor, grandtotal_currency, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      receiptId,
      SHOP_ID,
      "buyer-hash",
      "Portland",
      "US",
      opts.status ?? "completed",
      "cc",
      opts.createTimestamp ?? JULY_15_TS,
      opts.totalPriceAmount ?? 5000,
      100,
      opts.totalPriceCurrency ?? "USD",
      opts.discountAmount ?? 500,
      100,
      opts.discountCurrency ?? "USD",
      opts.grandTotalAmount ?? (opts.totalPriceAmount ?? 5000) - (opts.discountAmount ?? 500),
      100,
      "USD",
      SYNCED_AT,
    );
}

function insertApiTransaction(
  db: FullSchemaTestD1,
  transactionId: string,
  receiptId: string,
  opts: { quantity?: number } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_transactions (
          transaction_id, receipt_id, listing_id, title, quantity, price_amount,
          price_divisor, price_currency, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      transactionId,
      receiptId,
      "listing-1",
      "Pattern PDF",
      opts.quantity ?? 1,
      5000,
      100,
      "USD",
      SYNCED_AT,
    );
}

function insertApiPayment(
  db: FullSchemaTestD1,
  paymentId: string,
  receiptId: string,
  opts: {
    createTimestamp?: number;
    gross?: number;
    fees?: number;
    net?: number;
    grossCurrency?: string;
    feesCurrency?: string;
    netCurrency?: string;
    topLevelCurrency?: string;
  } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_payments (
          payment_id, shop_id, receipt_id, status, payment_method,
          amount_gross, amount_gross_divisor, amount_gross_currency,
          amount_fees, amount_fees_divisor, amount_fees_currency,
          amount_net, amount_net_divisor, amount_net_currency,
          create_timestamp, synced_at, currency, shop_currency, buyer_currency
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      paymentId,
      SHOP_ID,
      receiptId,
      "completed",
      "cc",
      opts.gross ?? 4500,
      100,
      opts.grossCurrency ?? "USD",
      opts.fees ?? 250,
      100,
      opts.feesCurrency ?? "USD",
      opts.net ?? 4250,
      100,
      opts.netCurrency ?? "USD",
      opts.createTimestamp ?? JULY_15_TS,
      SYNCED_AT,
      opts.topLevelCurrency ?? "USD",
      "USD",
      "USD",
    );
}

function insertCsvOrder(
  db: FullSchemaTestD1,
  orderId: string,
  opts: {
    saleDate?: string;
    orderValue?: number;
    discountAmount?: number;
  } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO orders (
          order_id, sale_date, ship_country, currency, order_value,
          discount_amount, status, number_of_items
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      orderId,
      opts.saleDate ?? "2026-07-15",
      "US",
      "USD",
      opts.orderValue ?? 25,
      opts.discountAmount ?? 0,
      "Completed",
      1,
    );
}

function insertReceiptRefund(
  db: FullSchemaTestD1,
  receiptId: string,
  opts: {
    amount?: number;
    divisor?: number;
    currency?: string;
    createdTimestamp?: number;
    status?: string;
  } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_receipt_refunds (
          receipt_id, amount, amount_divisor, amount_currency,
          created_timestamp, status, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      receiptId,
      opts.amount ?? 270,
      opts.divisor ?? 100,
      opts.currency ?? "USD",
      opts.createdTimestamp ?? JULY_15_TS,
      opts.status ?? "SUCCESS",
      SYNCED_AT,
    );
}

/** A CSV payment row. Gross/fees/net are TRY; refund_amount is USD (listing). */
function insertCsvPayment(
  db: FullSchemaTestD1,
  paymentId: string,
  orderId: string,
  opts: { refundAmount?: number; exchangeRate?: number; orderDate?: string } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO payments (
          payment_id, order_id, order_date, currency, listing_currency,
          exchange_rate, gross_amount, fees, net_amount, refund_amount
        ) VALUES (?, ?, ?, 'TRY', 'USD', ?, 183.61, 28.33, 155.28, ?)
      `,
    )
    .run(
      paymentId,
      orderId,
      opts.orderDate ?? "2026-07-15",
      opts.exchangeRate ?? 43.407491,
      opts.refundAmount ?? 0,
    );
}

describe("loadCommerceSummary", () => {
  it("returns correct order count, units, gross, and discounts for a fixture period", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "order-a", { totalPriceAmount: 6000, discountAmount: 600 });
    insertApiReceipt(db, "order-b", { totalPriceAmount: 4000, discountAmount: 400 });
    insertApiTransaction(db, "txn-a1", "order-a", { quantity: 2 });
    insertApiTransaction(db, "txn-b1", "order-b", { quantity: 1 });
    insertApiPayment(db, "pay-a", "order-a");
    insertApiPayment(db, "pay-b", "order-b");

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary).not.toBeNull();
    expect(summary?.period).toEqual({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
    });
    expect(summary?.status).toBe("complete");
    expect(summary?.recordsFetched).toBe(162);
    expect(summary?.orderCount).toBe(2);
    expect(summary?.unitsSold).toBe(3);
    expect(summary?.discounts).toEqual({
      value: 10,
      currency: "USD",
      available: true,
    });
    expect(summary?.grossSales).toEqual({
      value: 90,
      currency: "USD",
      available: true,
    });
    expect(summary?.etsyFees.available).toBe(true);
    expect(summary?.netSales.available).toBe(true);
  });

  it("marks netSales unavailable with a warning when payment coverage is incomplete", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "order-a", { totalPriceAmount: 5000, discountAmount: 0 });
    insertApiReceipt(db, "order-b", { totalPriceAmount: 3000, discountAmount: 0 });
    insertApiTransaction(db, "txn-a1", "order-a");
    insertApiTransaction(db, "txn-b1", "order-b");
    insertApiPayment(db, "pay-a", "order-a");

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary?.orderCount).toBe(2);
    expect(summary?.netSales).toEqual({
      value: null,
      currency: "USD",
      available: false,
    });
    expect(summary?.etsyFees.available).toBe(false);
    expect(summary?.warnings.some((warning) => warning.includes("covers 1 of 2"))).toBe(true);
  });

  it("sums mixed provenance rows once through canonical views", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "mixed-order", { totalPriceAmount: 5000, discountAmount: 500 });
    insertApiTransaction(db, "mixed-txn", "mixed-order", { quantity: 2 });
    insertApiPayment(db, "mixed-pay", "mixed-order");
    insertCsvOrder(db, "mixed-order", { orderValue: 999, discountAmount: 99 });

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary?.orderCount).toBe(1);
    expect(summary?.unitsSold).toBe(2);
    expect(summary?.grossSales.value).toBe(45);
    expect(summary?.discounts.value).toBe(5);
  });

  it("API-only TRY settlement reports fees and net in USD, not as TRY dollars", async () => {
    // Production receipt 4134970319: sold for USD 6.11, settled as 283.23 TRY,
    // every Money object labelled 'USD' because the buyer paid in USD. Before
    // migration 0027 the label won and this period published $32.41 / $250.82.
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "probe-order", {
      totalPriceAmount: 940,
      discountAmount: 329,
    });
    insertApiTransaction(db, "probe-txn", "probe-order");
    insertApiPayment(db, "probe-pay", "probe-order", {
      gross: 28323,
      fees: 3241,
      net: 25082,
      topLevelCurrency: "TRY",
    });

    const summary = await loadCommerceSummary(db, RUN_ID);
    expect(summary?.grossSales.value).toBeCloseTo(6.11, 6);
    expect(summary?.etsyFees.available).toBe(true);
    expect(summary?.etsyFees.value).toBeCloseTo(0.6993, 3);
    expect(summary?.netSales.available).toBe(true);
    expect(summary?.netSales.value).toBeCloseTo(5.4107, 3);
    // The defect this migration removes.
    expect(summary?.netSales.value).not.toBeCloseTo(250.82, 1);
  });

  it("reports the receipt refund Money, bucketed by the refund date", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "order-a");
    insertApiTransaction(db, "txn-a", "order-a");
    insertApiPayment(db, "pay-a", "order-a");

    // An April order refunded inside the July window still belongs to July.
    insertApiReceipt(db, "april-order", {
      createTimestamp: Math.floor(Date.UTC(2026, 3, 18) / 1000),
      status: "Canceled",
    });
    insertReceiptRefund(db, "april-order", { amount: 270, createdTimestamp: JULY_15_TS });
    // A refund outside the window must not be counted.
    insertApiReceipt(db, "other-order", { status: "Canceled" });
    insertReceiptRefund(db, "other-order", {
      amount: 999,
      createdTimestamp: Math.floor(Date.UTC(2026, 8, 4) / 1000),
    });

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary?.refunds.available).toBe(true);
    expect(summary?.refunds.value).toBeCloseTo(2.7, 6);
  });

  it("a failed or non-USD refund makes refunds unavailable rather than guessed", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "order-a");
    insertApiTransaction(db, "txn-a", "order-a");
    insertApiPayment(db, "pay-a", "order-a");
    insertReceiptRefund(db, "order-a", { amount: 270, currency: "TRY" });

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary?.refunds.available).toBe(false);
    expect(summary?.refunds.value).toBeNull();
  });

  it("a CSV refund is listing currency, never divided by the settlement rate", async () => {
    // Etsy's CSV mixes currencies in one row: Gross/Fees/Net are TRY but
    // "Refund Amount" is USD. Dividing 5.08 by 43.407491 reported $0.12.
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertCsvOrder(db, "csv-order", { orderValue: 9.4, discountAmount: 5.17 });
    insertCsvPayment(db, "csv-pay", "csv-order", {
      refundAmount: 5.08,
      exchangeRate: 43.407491,
    });

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary?.refunds.available).toBe(true);
    expect(summary?.refunds.value).toBeCloseTo(5.08, 6);
    expect(summary?.refunds.value).not.toBeCloseTo(5.08 / 43.407491, 4);
  });

  it("an order refunded in both sources is counted once", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "order-a", { status: "Canceled" });
    insertApiTransaction(db, "txn-a", "order-a");
    insertReceiptRefund(db, "order-a", { amount: 508 });
    // Same refund, seen from the CSV side.
    insertCsvPayment(db, "csv-pay", "order-a", { refundAmount: 5.08 });

    const summary = await loadCommerceSummary(db, RUN_ID);

    expect(summary?.refunds.available).toBe(true);
    expect(summary?.refunds.value).toBeCloseTo(5.08, 6);
  });

  it("marks grossSales unavailable when discount currency disagrees with order currency", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedApiShop(db);
    insertCommerceJob(db);

    insertApiReceipt(db, "mismatch-order", {
      totalPriceAmount: 940,
      discountAmount: 329,
      discountCurrency: "TRY",
      totalPriceCurrency: "USD",
    });
    insertApiTransaction(db, "mismatch-txn", "mismatch-order");
    insertApiPayment(db, "mismatch-pay", "mismatch-order", {
      gross: 940,
      fees: 150,
      net: 790,
    });

    const summary = await loadCommerceSummary(db, RUN_ID);
    expect(summary?.grossSales.available).toBe(false);
    expect(summary?.grossSales.value).toBeNull();
    expect(summary?.discounts.available).toBe(false);
    expect(
      summary?.warnings.some((warning) => warning.includes("discount currency disagreed")),
    ).toBe(true);
  });

  it("returns null when the run id is missing", async () => {
    const db = new FullSchemaTestD1();
    expect(await loadCommerceSummary(db, "missing-run")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";

const SHOP_ID = "shop-1";
const SYNCED_AT = "2026-01-01T00:00:00Z";
const CREATE_TS = 1_700_000_000;

type Row = Record<string, unknown>;

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

function insertCsvOrder(
  db: FullSchemaTestD1,
  orderId: string,
  opts: { coupon_code?: string; sale_date?: string } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO orders (
          order_id, sale_date, ship_country, currency, order_value, coupon_code, status, number_of_items
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      orderId,
      opts.sale_date ?? "2024-01-15",
      "US",
      "USD",
      25,
      opts.coupon_code ?? null,
      "Completed",
      1,
    );
}

function insertCsvOrderItem(
  db: FullSchemaTestD1,
  transactionId: string,
  orderId: string,
  opts: { coupon_code?: string; sale_date?: string } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO order_items (
          transaction_id, order_id, item_name, sale_date, quantity, item_total, currency
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      transactionId,
      orderId,
      "Pattern PDF",
      opts.sale_date ?? "2024-01-15",
      1,
      25,
      "USD",
    );
}

function insertCsvPayment(
  db: FullSchemaTestD1,
  paymentId: string,
  orderId: string,
  opts: { order_date?: string } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO payments (
          payment_id, order_id, order_date, gross_amount, fees, net_amount, currency, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(paymentId, orderId, opts.order_date ?? "2024-01-15", 25, 2.5, 22.5, "USD", "completed");
}

function insertApiReceipt(
  db: FullSchemaTestD1,
  receiptId: string,
  opts: { create_timestamp?: number } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, buyer_hash, city, country_iso, status, payment_method,
          create_timestamp, total_price_amount, total_price_divisor, total_price_currency,
          grandtotal_amount, grandtotal_divisor, grandtotal_currency, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      receiptId,
      SHOP_ID,
      "buyer-hash",
      "Portland",
      "US",
      "completed",
      "cc",
      opts.create_timestamp ?? CREATE_TS,
      2500,
      100,
      "USD",
      2500,
      100,
      "USD",
      SYNCED_AT,
    );
}

function insertApiTransaction(
  db: FullSchemaTestD1,
  transactionId: string,
  receiptId: string,
  opts: { listing_id?: string } = {},
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
      opts.listing_id ?? null,
      "Pattern PDF",
      1,
      2500,
      100,
      "USD",
      SYNCED_AT,
    );
}

function insertApiPayment(db: FullSchemaTestD1, paymentId: string, receiptId: string): void {
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
      2500,
      100,
      "USD",
      250,
      100,
      "USD",
      2250,
      100,
      "USD",
      CREATE_TS,
      SYNCED_AT,
      "USD",
      "USD",
      "USD",
    );
}

function queryView(db: FullSchemaTestD1, viewName: string): Row[] {
  return db.sqlite.prepare(`SELECT * FROM ${viewName}`).all() as Row[];
}

function assertAllDataSource(rows: Row[], expected: string): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.data_source).toBe(expected);
  }
}

function assertColumnKeysMatch(apiRow: Row, csvRow: Row, label: string): void {
  expect(new Set(Object.keys(apiRow))).toEqual(new Set(Object.keys(csvRow)));
  expect(Object.keys(apiRow).sort()).toEqual(Object.keys(csvRow).sort());
  void label;
}

describe("FullSchemaTestD1 smoke", () => {
  it("applies all migrations including 0026 canonical views", () => {
    const db = new FullSchemaTestD1();
    const views = db.sqlite
      .prepare(
        `
          SELECT name FROM sqlite_master
          WHERE type = 'view'
            AND name IN (
              'v_orders_canonical',
              'v_order_items_canonical',
              'v_payments_canonical'
            )
        `,
      )
      .all() as { name: string }[];

    expect(views.map((v) => v.name).sort()).toEqual([
      "v_order_items_canonical",
      "v_orders_canonical",
      "v_payments_canonical",
    ]);

    const coverageTable = db.sqlite
      .prepare(
        `
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'etsy_commerce_period_coverage'
        `,
      )
      .get() as { name: string } | undefined;
    expect(coverageTable?.name).toBe("etsy_commerce_period_coverage");
  });
});

describe("Phase 2 canonical views (0026)", () => {
  it("CSV-only DB returns only csv_upload rows in all three views", () => {
    const db = new FullSchemaTestD1();

    insertCsvOrder(db, "csv-order-1");
    insertCsvOrder(db, "csv-order-2");
    insertCsvOrderItem(db, "csv-txn-1", "csv-order-1");
    insertCsvOrderItem(db, "csv-txn-2", "csv-order-2");
    insertCsvPayment(db, "csv-pay-1", "csv-order-1");
    insertCsvPayment(db, "csv-pay-2", "csv-order-2");

    assertAllDataSource(queryView(db, "v_orders_canonical"), "csv_upload");
    assertAllDataSource(queryView(db, "v_order_items_canonical"), "csv_upload");
    assertAllDataSource(queryView(db, "v_payments_canonical"), "csv_upload");

    expect(queryView(db, "v_orders_canonical")).toHaveLength(2);
    expect(queryView(db, "v_order_items_canonical")).toHaveLength(2);
    expect(queryView(db, "v_payments_canonical")).toHaveLength(2);
  });

  it("API-only DB returns only etsy_api rows without cutover settings", () => {
    const db = new FullSchemaTestD1();
    seedApiShop(db);

    insertApiReceipt(db, "api-rcpt-1");
    insertApiReceipt(db, "api-rcpt-2");
    insertApiTransaction(db, "api-txn-1", "api-rcpt-1");
    insertApiTransaction(db, "api-txn-2", "api-rcpt-2");
    insertApiPayment(db, "api-pay-1", "api-rcpt-1");
    insertApiPayment(db, "api-pay-2", "api-rcpt-2");

    const cutover = db.sqlite
      .prepare("SELECT COUNT(*) AS n FROM etsy_financial_cutover_settings")
      .get() as { n: number };
    expect(cutover.n).toBe(0);

    assertAllDataSource(queryView(db, "v_orders_canonical"), "etsy_api");
    assertAllDataSource(queryView(db, "v_order_items_canonical"), "etsy_api");
    assertAllDataSource(queryView(db, "v_payments_canonical"), "etsy_api");
  });

  it("mixed DB dedupes overlapping orders and keeps CSV-only fallback rows", () => {
    const db = new FullSchemaTestD1();
    seedApiShop(db);

    insertApiReceipt(db, "mixed-order-a");
    insertCsvOrder(db, "mixed-order-a");
    insertCsvOrder(db, "csv-only-order-b");

    const rows = queryView(db, "v_orders_canonical");
    expect(rows).toHaveLength(2);

    const byId = new Map(rows.map((row) => [row.order_id, row]));
    expect(byId.get("mixed-order-a")?.data_source).toBe("etsy_api+csv");
    expect(byId.get("csv-only-order-b")?.data_source).toBe("csv_upload");
  });

  it("enriches API orders with CSV coupon_code and marks etsy_api+csv", () => {
    const db = new FullSchemaTestD1();
    seedApiShop(db);

    insertApiReceipt(db, "enriched-order");
    insertCsvOrder(db, "enriched-order", { coupon_code: "SAVE10" });

    const row = queryView(db, "v_orders_canonical").find((r) => r.order_id === "enriched-order");
    expect(row).toBeDefined();
    expect(row?.data_source).toBe("etsy_api+csv");
    expect(row?.coupon_code).toBe("SAVE10");
  });

  it("UNION branches expose identical column sets per canonical view", () => {
    const db = new FullSchemaTestD1();
    seedApiShop(db);

    insertApiReceipt(db, "union-api-order");
    insertApiTransaction(db, "union-api-txn", "union-api-order");
    insertApiPayment(db, "union-api-pay", "union-api-order");

    insertCsvOrder(db, "union-csv-order");
    insertCsvOrderItem(db, "union-csv-txn", "union-csv-order");
    insertCsvPayment(db, "union-csv-pay", "union-csv-order");

    const orders = queryView(db, "v_orders_canonical");
    const orderItems = queryView(db, "v_order_items_canonical");
    const payments = queryView(db, "v_payments_canonical");

    const apiOrder = orders.find((row) => row.order_id === "union-api-order");
    const csvOrder = orders.find((row) => row.order_id === "union-csv-order");
    expect(apiOrder).toBeDefined();
    expect(csvOrder).toBeDefined();
    assertColumnKeysMatch(apiOrder!, csvOrder!, "v_orders_canonical");

    const apiItem = orderItems.find((row) => row.transaction_id === "union-api-txn");
    const csvItem = orderItems.find((row) => row.transaction_id === "union-csv-txn");
    expect(apiItem).toBeDefined();
    expect(csvItem).toBeDefined();
    assertColumnKeysMatch(apiItem!, csvItem!, "v_order_items_canonical");

    const apiPayment = payments.find((row) => row.payment_id === "union-api-pay");
    const csvPayment = payments.find((row) => row.payment_id === "union-csv-pay");
    expect(apiPayment).toBeDefined();
    expect(csvPayment).toBeDefined();
    assertColumnKeysMatch(apiPayment!, csvPayment!, "v_payments_canonical");
  });
});

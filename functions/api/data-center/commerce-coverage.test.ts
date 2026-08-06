import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";
import { onRequestGet } from "./commerce-coverage";

function seedConnection(db: FullSchemaTestD1, shopId = "shop-1"): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_connections (
          shop_id, etsy_user_id, scopes_json,
          access_token_ciphertext, access_token_iv,
          refresh_token_ciphertext, refresh_token_iv,
          access_token_expires_at, status
        ) VALUES (?, 'user-1', '[]', 'cipher', 'iv', 'refresh', 'refresh-iv', '2099-01-01T00:00:00Z', 'connected')
      `,
    )
    .run(shopId);
}

function seedSalesWatermark(
  db: FullSchemaTestD1,
  shopId: string,
  cursorValue: string,
  lastSuccessAt: string,
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_sync_cursors (
          shop_id, resource, cursor_key, cursor_value, last_success_at
        ) VALUES (?, 'sales', 'last_modified', ?, ?)
      `,
    )
    .run(shopId, cursorValue, lastSuccessAt);
}

function seedPeriodCoverage(
  db: FullSchemaTestD1,
  input: {
    shopId: string;
    fromTs: number;
    toExclusiveTs: number;
    status: string;
    etsyReceiptCount?: number;
    persistedReceiptCount?: number;
    paymentParentsSelected?: number;
    paymentParentsChecked?: number;
    ledgerComplete?: number;
    firstSyncedAt?: string;
    lastRefreshedAt?: string;
  },
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_commerce_period_coverage (
          shop_id, from_ts, to_ts, last_run_id, status,
          etsy_receipt_count, persisted_receipt_count,
          payment_parents_selected, payment_parents_checked,
          ledger_complete, first_synced_at, last_refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.shopId,
      input.fromTs,
      input.toExclusiveTs,
      `run-${input.fromTs}`,
      input.status,
      input.etsyReceiptCount ?? null,
      input.persistedReceiptCount ?? null,
      input.paymentParentsSelected ?? null,
      input.paymentParentsChecked ?? null,
      input.ledgerComplete ?? 0,
      input.firstSyncedAt ?? "2026-08-01T00:00:00Z",
      input.lastRefreshedAt ?? "2026-08-01T01:00:00Z",
    );
}

function insertCsvOrder(db: FullSchemaTestD1, orderId: string, saleDate: string): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO orders (
          order_id, sale_date, ship_country, currency, order_value, status, number_of_items
        ) VALUES (?, ?, 'US', 'USD', 25, 'Completed', 1)
      `,
    )
    .run(orderId, saleDate);
}

function insertCsvOrderItem(
  db: FullSchemaTestD1,
  transactionId: string,
  orderId: string,
  saleDate: string,
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO order_items (
          transaction_id, order_id, item_name, sale_date, quantity, item_total, currency
        ) VALUES (?, ?, 'Pattern PDF', ?, 1, 25, 'USD')
      `,
    )
    .run(transactionId, orderId, saleDate);
}

function insertCsvPayment(
  db: FullSchemaTestD1,
  paymentId: string,
  orderId: string,
  orderDate: string,
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO payments (
          payment_id, order_id, order_date, gross_amount, fees, net_amount, currency, status
        ) VALUES (?, ?, ?, 25, 2, 23, 'USD', 'Completed')
      `,
    )
    .run(paymentId, orderId, orderDate);
}

describe("commerce-coverage endpoint", () => {
  it("returns watermark and periods newest-first", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    seedSalesWatermark(db, "shop-1", "1785000000", "2026-08-05T03:00:11Z");

    const julyFromTs = Date.UTC(2026, 6, 1) / 1000;
    const julyToExclusiveTs = Date.UTC(2026, 7, 1) / 1000;
    const augustFromTs = Date.UTC(2026, 7, 1) / 1000;
    const augustToExclusiveTs = Date.UTC(2026, 8, 1) / 1000;

    seedPeriodCoverage(db, {
      shopId: "shop-1",
      fromTs: julyFromTs,
      toExclusiveTs: julyToExclusiveTs,
      status: "complete",
      etsyReceiptCount: 100,
      persistedReceiptCount: 100,
      paymentParentsSelected: 100,
      paymentParentsChecked: 100,
      ledgerComplete: 1,
      firstSyncedAt: "2026-07-02T00:00:00Z",
      lastRefreshedAt: "2026-07-02T01:00:00Z",
    });
    seedPeriodCoverage(db, {
      shopId: "shop-1",
      fromTs: augustFromTs,
      toExclusiveTs: augustToExclusiveTs,
      status: "partial",
      etsyReceiptCount: 50,
      persistedReceiptCount: 48,
      paymentParentsSelected: 50,
      paymentParentsChecked: 49,
      ledgerComplete: 0,
      firstSyncedAt: "2026-08-02T00:00:00Z",
      lastRefreshedAt: "2026-08-02T01:00:00Z",
    });

    const response = await onRequestGet({
      request: new Request("https://example.test/api/data-center/commerce-coverage?limit=24"),
      env: { DB: db },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.watermark).toEqual({
      cursorValue: 1785000000,
      lastSuccessAt: "2026-08-05T03:00:11Z",
    });
    expect(body.periods).toHaveLength(2);
    expect(body.periods[0]).toMatchObject({
      fromTs: augustFromTs,
      toExclusiveTs: augustToExclusiveTs,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      status: "partial",
      etsyReceiptCount: 50,
      persistedReceiptCount: 48,
      paymentParentsSelected: 50,
      paymentParentsChecked: 49,
      ledgerComplete: false,
      firstSyncedAt: "2026-08-02T00:00:00Z",
      lastRefreshedAt: "2026-08-02T01:00:00Z",
    });
    expect(body.periods[1]).toMatchObject({
      fromTs: julyFromTs,
      toExclusiveTs: julyToExclusiveTs,
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      status: "complete",
      ledgerComplete: true,
    });
  });

  it("reports csvPresence as presence only", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);

    insertCsvOrder(db, "order-july", "2026-07-15");
    insertCsvOrderItem(db, "txn-july", "order-july", "2026-07-15");
    insertCsvPayment(db, "payment-aug", "order-aug", "2026-08-10");
    insertCsvOrder(db, "order-aug", "2026-08-10");

    const response = await onRequestGet({
      request: new Request("https://example.test/api/data-center/commerce-coverage"),
      env: { DB: db },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.csvPresence).toEqual([
      { month: "2026-07", orders: true, orderItems: true, payments: false },
      { month: "2026-08", orders: true, orderItems: false, payments: true },
    ]);
    expect(body.csvPresence[0]).not.toHaveProperty("complete");
    expect(body.csvPresence[0]).not.toHaveProperty("missingMonths");
    expect(body.csvPresence[1]).not.toHaveProperty("complete");
    expect(body.csvPresence[1]).not.toHaveProperty("missingMonths");
  });
});

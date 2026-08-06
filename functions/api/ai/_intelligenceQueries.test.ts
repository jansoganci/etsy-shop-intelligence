import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";
import { computeShopOverview } from "./_intelligenceQueries";

const SHOP_ID = "shop-1";
const SYNCED_AT = "2026-01-01T00:00:00Z";
const JAN_10_2026_TS = Math.floor(Date.UTC(2026, 0, 10) / 1000);
const JAN_20_2026_TS = Math.floor(Date.UTC(2026, 0, 20) / 1000);

function seedApiShop(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_shops (shop_id, user_id, shop_name, synced_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(SHOP_ID, "user-1", "Test Shop", SYNCED_AT);
}

function insertCsvOrder(db: FullSchemaTestD1, orderId: string, saleDate: string): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO orders (
          order_id, sale_date, ship_country, currency, order_value, status, number_of_items
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(orderId, saleDate, "US", "USD", 20, "Completed", 1);
}

function insertCsvPayment(db: FullSchemaTestD1, paymentId: string, orderId: string, orderDate: string): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO payments (
          payment_id, order_id, order_date, gross_amount, fees, net_amount, currency, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(paymentId, orderId, orderDate, 20, 2, 18, "USD", "completed");
}

function insertApiReceipt(
  db: FullSchemaTestD1,
  receiptId: string,
  createTimestamp: number,
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
      createTimestamp,
      2000,
      100,
      "USD",
      2000,
      100,
      "USD",
      SYNCED_AT,
    );
}

function insertApiPayment(db: FullSchemaTestD1, paymentId: string, receiptId: string, createTimestamp: number): void {
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
      2000,
      100,
      "USD",
      200,
      100,
      "USD",
      1800,
      100,
      "USD",
      createTimestamp,
      SYNCED_AT,
      "USD",
      "USD",
      "USD",
    );
}

describe("computeShopOverview provenance", () => {
  it("reports csv_upload for CSV-only financial rows", async () => {
    const db = new FullSchemaTestD1();
    insertCsvOrder(db, "csv-order", "2026-01-15");
    insertCsvPayment(db, "csv-pay", "csv-order", "2026-01-15");

    const result = await computeShopOverview(db, "2026-01");

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.provenance.orders).toBe("csv_upload");
    expect(result.provenance.payments).toBe("csv_upload");
  });

  it("reports etsy_api and etsy_api+csv across mixed canonical rows", async () => {
    const db = new FullSchemaTestD1();
    seedApiShop(db);
    insertApiReceipt(db, "api-only", JAN_10_2026_TS);
    insertApiPayment(db, "api-pay", "api-only", JAN_10_2026_TS);
    insertApiReceipt(db, "api-enriched", JAN_20_2026_TS);
    insertCsvOrder(db, "api-enriched", "2026-01-20");
    insertApiPayment(db, "api-pay-enriched", "api-enriched", JAN_20_2026_TS);

    const result = await computeShopOverview(db, "2026-01");

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.provenance.orders).toBe("mixed");
    expect(result.provenance.payments).toBe("etsy_api");
  });
});

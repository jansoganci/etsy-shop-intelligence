import { afterEach, describe, expect, it } from "vitest";
import { insertOrder, insertOrderItem, TestD1 } from "../reports/_testDb";
import { getListingPerformance } from "./_performance";

describe("getListingPerformance — currency validation", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("reports Gross Sales (USD) when every row is USD, subtracting discounts", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-01-05" });
    insertOrderItem(db, {
      transaction_id: "txn-1",
      order_id: "order-1",
      listing_id: "listing-1",
      sale_date: "2026-01-05",
      item_total: 100,
      discount_amount: 20,
      currency: "USD",
    });

    const result = await getListingPerformance(db, "listing-1");

    expect(result.currencyValid).toBe(true);
    expect(result.totalGrossSalesUsd).toBe(80);
    expect(result.totalOrders).toBe(1);
  });

  it("treats a single non-USD currency as invalid rather than mislabeling it USD", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-01-05" });
    insertOrderItem(db, {
      transaction_id: "txn-1",
      order_id: "order-1",
      listing_id: "listing-try",
      sale_date: "2026-01-05",
      item_total: 4000,
      discount_amount: 0,
      currency: "TRY",
    });

    const result = await getListingPerformance(db, "listing-try");

    expect(result.currencyValid).toBe(false);
    expect(result.totalGrossSalesUsd).toBeNull();
  });

  it("treats mixed currencies as invalid", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-01-05" });
    insertOrderItem(db, {
      transaction_id: "txn-1",
      order_id: "order-1",
      listing_id: "listing-mixed",
      sale_date: "2026-01-05",
      item_total: 100,
      discount_amount: 0,
      currency: "USD",
    });
    insertOrder(db, { order_id: "order-2", sale_date: "2026-01-06" });
    insertOrderItem(db, {
      transaction_id: "txn-2",
      order_id: "order-2",
      listing_id: "listing-mixed",
      sale_date: "2026-01-06",
      item_total: 4000,
      discount_amount: 0,
      currency: "TRY",
    });

    const result = await getListingPerformance(db, "listing-mixed");

    expect(result.currencyValid).toBe(false);
    expect(result.totalGrossSalesUsd).toBeNull();
  });

  it("treats a missing (NULL) currency row as invalid, even alongside otherwise-consistent USD rows", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-01-05" });
    insertOrderItem(db, {
      transaction_id: "txn-1",
      order_id: "order-1",
      listing_id: "listing-missing",
      sale_date: "2026-01-05",
      item_total: 100,
      discount_amount: 0,
      currency: "USD",
    });
    insertOrder(db, { order_id: "order-2", sale_date: "2026-01-06" });
    insertOrderItem(db, {
      transaction_id: "txn-2",
      order_id: "order-2",
      listing_id: "listing-missing",
      sale_date: "2026-01-06",
      item_total: 50,
      discount_amount: 0,
      currency: null,
    });

    const result = await getListingPerformance(db, "listing-missing");

    // Regression guard: COUNT(DISTINCT item_currency) ignores NULLs, so the
    // old check ((count <= 1)) would have passed this as "USD" using only
    // the one real USD row's total while silently dropping the NULL row's
    // currency problem. It must be invalid instead.
    expect(result.currencyValid).toBe(false);
    expect(result.totalGrossSalesUsd).toBeNull();
  });

  it("reports $0, not 'insufficient currency information', for a listing with no order history yet", async () => {
    db = new TestD1();

    const result = await getListingPerformance(db, "listing-never-sold");

    expect(result.totalOrders).toBe(0);
    expect(result.currencyValid).toBe(true);
    expect(result.totalGrossSalesUsd).toBe(0);
  });
});

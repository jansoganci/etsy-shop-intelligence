import { afterEach, describe, expect, it } from "vitest";
import { insertOrder, insertOrderItem, TestD1 } from "../_testDb";
import { onRequestGet } from "./summary";

type Kpi = { key: string; value: number | string | null };
type ChartRow = Record<string, unknown>;

function request(query: string): Request {
  return new Request(`https://example.com/api/reports/order-items/summary?compare=none&${query}`);
}

async function run(db: TestD1, query: string) {
  const response = await onRequestGet({ request: request(query), env: { DB: db } });
  return (await response.json()) as {
    kpis: Kpi[];
    warnings: string[];
    charts: { topListings: ChartRow[] };
  };
}

function kpi(body: { kpis: Kpi[] }, key: string): Kpi | undefined {
  return body.kpis.find((item) => item.key === key);
}

describe("order items summary — discount-adjusted revenue", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("subtracts discount_amount from item_total for List Value's Listing Gross Sales KPI", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-02-10" });
    insertOrderItem(db, {
      transaction_id: "txn-1",
      order_id: "order-1",
      listing_id: "listing-1",
      sale_date: "2026-02-10",
      item_total: 100,
      discount_amount: 20,
      currency: "USD",
    });
    insertOrder(db, { order_id: "order-2", sale_date: "2026-02-11" });
    insertOrderItem(db, {
      transaction_id: "txn-2",
      order_id: "order-2",
      listing_id: "listing-2",
      sale_date: "2026-02-11",
      item_total: 50,
      discount_amount: 0,
      currency: "USD",
    });

    const body = await run(db, "dateFrom=2026-02-01&dateTo=2026-02-28");

    // List Value stays pre-discount (catalog value).
    expect(kpi(body, "total_item_revenue_USD")?.value).toBe(150);
    // Listing Gross Sales is the new, post-discount, currency-validated figure.
    expect(kpi(body, "listing_gross_sales_usd")?.value).toBe(130);
  });

  it("ranks Top Listings by post-discount revenue, not raw item_total", async () => {
    db = new TestD1();

    // Listing A: bigger catalog value but a heavy discount, so its realized
    // revenue is actually lower than Listing B's.
    insertOrder(db, { order_id: "order-a", sale_date: "2026-03-01" });
    insertOrderItem(db, {
      transaction_id: "txn-a",
      order_id: "order-a",
      listing_id: "listing-a",
      listing_title: "Listing A",
      sale_date: "2026-03-01",
      item_total: 100,
      discount_amount: 60,
      currency: "USD",
    });
    insertOrder(db, { order_id: "order-b", sale_date: "2026-03-02" });
    insertOrderItem(db, {
      transaction_id: "txn-b",
      order_id: "order-b",
      listing_id: "listing-b",
      listing_title: "Listing B",
      sale_date: "2026-03-02",
      item_total: 80,
      discount_amount: 0,
      currency: "USD",
    });

    const body = await run(db, "dateFrom=2026-03-01&dateTo=2026-03-31");

    const topListings = body.charts.topListings;
    expect(topListings[0]?.listingId).toBe("listing-b");
    expect(topListings[0]?.revenue).toBe(80);
    expect(topListings[1]?.revenue).toBe(40);
  });

  it("marks Listing Gross Sales (USD) unavailable when item currency is mixed", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-usd", sale_date: "2026-04-01" });
    insertOrderItem(db, {
      transaction_id: "txn-usd",
      order_id: "order-usd",
      listing_id: "listing-usd",
      sale_date: "2026-04-01",
      item_total: 100,
      discount_amount: 0,
      currency: "USD",
    });
    insertOrder(db, { order_id: "order-try", sale_date: "2026-04-02" });
    insertOrderItem(db, {
      transaction_id: "txn-try",
      order_id: "order-try",
      listing_id: "listing-try",
      sale_date: "2026-04-02",
      item_total: 4000,
      discount_amount: 0,
      currency: "TRY",
    });

    const body = await run(db, "dateFrom=2026-04-01&dateTo=2026-04-30");

    expect(kpi(body, "listing_gross_sales_usd")).toBeUndefined();
    expect(
      body.warnings.some((warning) => /Listing Gross Sales \(USD\) is unavailable/i.test(warning)),
    ).toBe(true);
  });
});

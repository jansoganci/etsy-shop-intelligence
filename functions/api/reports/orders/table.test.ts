import { afterEach, describe, expect, it } from "vitest";
import { insertOrder, insertPayment, TestD1 } from "../_testDb";
import { onRequestGet } from "./table";

type Row = {
  orderId: string;
  netUsdRevenue: number | null;
  revenueAfterDiscount: number | null;
  profitMargin: number | null;
};

async function rows(db: TestD1): Promise<Row[]> {
  const response = await onRequestGet({
    request: new Request("https://example.com/api/reports/orders/table?pageSize=50"),
    env: { DB: db },
  });
  const body = (await response.json()) as { rows: Row[] };
  return body.rows;
}

function byId(list: Row[], orderId: string): Row | undefined {
  return list.find((row) => row.orderId === orderId);
}

describe("orders table — per-row Net Revenue (USD)", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("uses payments.net_amount (not orders payout fields) for a single USD payment row", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-single-usd",
      sale_date: "2026-01-05",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-1",
      order_id: "order-single-usd",
      order_date: "2026-01-05",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });

    const list = await rows(db);
    const row = byId(list, "order-single-usd");

    expect(row?.netUsdRevenue).toBe(90);
    expect(row?.revenueAfterDiscount).toBe(100);
    expect(row?.profitMargin).toBeCloseTo(0.9, 8);
  });

  it("converts a single CSV TRY payment row using that row's own exchange rate", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-single-try",
      sale_date: "2026-01-06",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-2",
      order_id: "order-single-try",
      order_date: "2026-01-06",
      gross_amount: 4000,
      fees: 400,
      net_amount: 3600,
      currency: "TRY",
      listing_currency: "USD",
      exchange_rate: 40,
    });

    const list = await rows(db);
    const row = byId(list, "order-single-try");

    expect(row?.netUsdRevenue).toBe(90);
  });

  it("returns NULL rather than an averaged rate when an order has more than one payment row", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-multi",
      sale_date: "2026-01-07",
      currency: "USD",
      order_value: 150,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-3a",
      order_id: "order-multi",
      order_date: "2026-01-07",
      gross_amount: 4000,
      fees: 400,
      net_amount: 3600,
      currency: "TRY",
      listing_currency: "USD",
      exchange_rate: 40,
    });
    insertPayment(db, {
      payment_id: "pay-3b",
      order_id: "order-multi",
      order_date: "2026-01-07",
      gross_amount: 2000,
      fees: 200,
      net_amount: 1800,
      currency: "TRY",
      listing_currency: "USD",
      exchange_rate: 20,
    });

    const list = await rows(db);
    const row = byId(list, "order-multi");

    expect(row?.netUsdRevenue).toBeNull();
    expect(row?.profitMargin).toBeNull();
  });

  it("returns NULL rather than 0 when an order has no matching payment row", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-no-payment",
      sale_date: "2026-01-08",
      currency: "USD",
      order_value: 80,
      discount_amount: 0,
    });

    const list = await rows(db);
    const row = byId(list, "order-no-payment");

    expect(row?.netUsdRevenue).toBeNull();
    // Revenue after discount is order-side only, so it's still available for USD.
    expect(row?.revenueAfterDiscount).toBe(80);
  });

  it("returns NULL Gross Sales and Profit Margin for non-USD order currency", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-eur-currency",
      sale_date: "2026-01-09",
      currency: "EUR",
      order_value: 100,
      discount_amount: 10,
    });
    insertPayment(db, {
      payment_id: "pay-eur-currency",
      order_id: "order-eur-currency",
      order_date: "2026-01-09",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });

    const list = await rows(db);
    const row = byId(list, "order-eur-currency");

    expect(row?.revenueAfterDiscount).toBeNull();
    expect(row?.profitMargin).toBeNull();
    // Net Revenue is payment-side and may still be available.
    expect(row?.netUsdRevenue).toBe(90);
  });

  it("returns NULL Gross Sales when order currency is missing", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-missing-currency",
      sale_date: "2026-01-10",
      currency: null,
      order_value: 100,
      discount_amount: 0,
    });

    const list = await rows(db);
    const row = byId(list, "order-missing-currency");

    expect(row?.revenueAfterDiscount).toBeNull();
    expect(row?.profitMargin).toBeNull();
  });

  it("returns NULL Gross Sales when order_value is missing (never COALESCE to zero)", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-missing-value",
      sale_date: "2026-01-11",
      currency: "USD",
      order_value: null,
      discount_amount: 0,
    });

    const list = await rows(db);
    const row = byId(list, "order-missing-value");

    expect(row?.revenueAfterDiscount).toBeNull();
  });

  it("returns NULL Net Revenue for unsupported payment currency (not USD and not TRY/USD with rate)", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-eur-payment",
      sale_date: "2026-01-12",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    // CSV path unsupported currency — table SQL only converts USD or TRY/USD+rate.
    insertPayment(db, {
      payment_id: "pay-eur-payment",
      order_id: "order-eur-payment",
      order_date: "2026-01-12",
      gross_amount: 90,
      fees: 9,
      net_amount: 81,
      currency: "EUR",
      listing_currency: "USD",
      exchange_rate: null,
    });

    const list = await rows(db);
    const row = byId(list, "order-eur-payment");

    expect(row?.netUsdRevenue).toBeNull();
  });
});

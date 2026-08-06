import { afterEach, describe, expect, it } from "vitest";
import { insertOrder, insertPayment, TestD1 } from "../_testDb";
import { onRequestGet } from "./summary";

function request(query: string): Request {
  return new Request(`https://example.com/api/reports/orders/summary?compare=none&${query}`);
}

type Kpi = { key: string; value: number | string | null };

async function run(db: TestD1, query: string) {
  const response = await onRequestGet({ request: request(query), env: { DB: db } });
  const body = (await response.json()) as { kpis: Kpi[]; warnings: string[] };
  return body;
}

function kpi(body: { kpis: Kpi[] }, key: string): Kpi | undefined {
  return body.kpis.find((item) => item.key === key);
}

describe("orders summary — payment cohort scoping", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("scopes Net Revenue to the filtered order cohort, not every payment in the date range", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-de",
      sale_date: "2026-03-10",
      ship_country: "DE",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-de",
      order_id: "order-de",
      order_date: "2026-03-10",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });

    // Same date range, different country — must NOT leak into a Germany-filtered cohort.
    insertOrder(db, {
      order_id: "order-tr",
      sale_date: "2026-03-11",
      ship_country: "TR",
      currency: "USD",
      order_value: 200,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-tr",
      order_id: "order-tr",
      order_date: "2026-03-11",
      gross_amount: 200,
      fees: 20,
      net_amount: 180,
      currency: "USD",
      listing_currency: "USD",
    });

    const filtered = await run(db, "dateFrom=2026-03-01&dateTo=2026-03-31&country=DE");

    expect(kpi(filtered, "net_usd_revenue")?.value).toBe(90);
    expect(kpi(filtered, "revenue_after_discount_usd")?.value).toBe(100);

    const unfiltered = await run(db, "dateFrom=2026-03-01&dateTo=2026-03-31");

    expect(kpi(unfiltered, "net_usd_revenue")?.value).toBe(270);
  });

  it("uses payments.order_date for Net Revenue when sale_date and payment date differ by month", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-cross-month",
      sale_date: "2026-03-31",
      ship_country: "US",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-cross-month",
      order_id: "order-cross-month",
      order_date: "2026-04-01",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });

    const march = await run(db, "dateFrom=2026-03-01&dateTo=2026-03-31");
    // Order is in March, but payment is not — do not publish March Net Revenue.
    expect(kpi(march, "total_orders")?.value).toBe(1);
    expect(kpi(march, "net_usd_revenue")).toBeUndefined();
    expect(
      march.warnings.some((warning) => /covers 0 of 1 selected orders/i.test(warning)),
    ).toBe(true);

    const april = await run(db, "dateFrom=2026-04-01&dateTo=2026-04-30");
    // Payment-date rule: April Net Revenue includes the payment even though sale_date is March.
    expect(kpi(april, "total_orders")?.value).toBe(0);
    expect(kpi(april, "net_usd_revenue")?.value).toBe(90);
  });

  it("marks Net Revenue unavailable when the filtered orders have no matching payment rows", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-no-payment",
      sale_date: "2026-04-05",
      ship_country: "US",
      currency: "USD",
      order_value: 50,
      discount_amount: 0,
    });

    const body = await run(db, "dateFrom=2026-04-01&dateTo=2026-04-30");

    expect(kpi(body, "net_usd_revenue")).toBeUndefined();
    expect(
      body.warnings.some((warning) => /covers 0 of 1 selected orders/i.test(warning)),
    ).toBe(true);
  });

  it("marks Net Revenue unavailable on partial payment coverage", async () => {
    db = new TestD1();

    for (let index = 1; index <= 3; index += 1) {
      insertOrder(db, {
        order_id: `order-partial-${index}`,
        sale_date: `2026-05-0${index}`,
        ship_country: "US",
        currency: "USD",
        order_value: 100,
        discount_amount: 0,
      });
    }
    // Only 2 of 3 selected orders have payments.
    insertPayment(db, {
      payment_id: "pay-partial-1",
      order_id: "order-partial-1",
      order_date: "2026-05-01",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });
    insertPayment(db, {
      payment_id: "pay-partial-2",
      order_id: "order-partial-2",
      order_date: "2026-05-02",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });

    const body = await run(db, "dateFrom=2026-05-01&dateTo=2026-05-31");

    expect(kpi(body, "net_usd_revenue")).toBeUndefined();
    expect(
      body.warnings.some((warning) => /covers 2 of 3 selected orders/i.test(warning)),
    ).toBe(true);
  });

  it("marks Gross Sales (USD) unavailable when the cohort's order currency is mixed", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-usd",
      sale_date: "2026-05-01",
      ship_country: "US",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertOrder(db, {
      order_id: "order-try",
      sale_date: "2026-05-02",
      ship_country: "TR",
      currency: "TRY",
      order_value: 4000,
      discount_amount: 0,
    });

    const body = await run(db, "dateFrom=2026-05-01&dateTo=2026-05-31");

    expect(kpi(body, "revenue_after_discount_usd")).toBeUndefined();
    expect(
      body.warnings.some((warning) => /order currency is not complete USD/i.test(warning)),
    ).toBe(true);
  });

  it("sums net revenue across multiple payment rows that belong to the same cohort", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-multi",
      sale_date: "2026-06-01",
      ship_country: "US",
      currency: "USD",
      order_value: 150,
      discount_amount: 0,
    });
    // Two payment rows for the same order (e.g. a split settlement).
    insertPayment(db, {
      payment_id: "pay-multi-1",
      order_id: "order-multi",
      order_date: "2026-06-01",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });
    insertPayment(db, {
      payment_id: "pay-multi-2",
      order_id: "order-multi",
      order_date: "2026-06-01",
      gross_amount: 50,
      fees: 5,
      net_amount: 45,
      currency: "USD",
      listing_currency: "USD",
    });

    const body = await run(db, "dateFrom=2026-06-01&dateTo=2026-06-30");

    expect(kpi(body, "net_usd_revenue")?.value).toBe(135);
  });

  it("converts a CSV TRY payment row to USD using that row's own exchange rate", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-csv-try",
      sale_date: "2026-07-01",
      ship_country: "TR",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-csv-try",
      order_id: "order-csv-try",
      order_date: "2026-07-01",
      gross_amount: 4000,
      fees: 400,
      net_amount: 3600,
      currency: "TRY",
      listing_currency: "USD",
      exchange_rate: 40,
    });

    const body = await run(db, "dateFrom=2026-07-01&dateTo=2026-07-31");

    expect(kpi(body, "net_usd_revenue")?.value).toBe(90);
  });

  it("marks Net Revenue unavailable when a payment row is missing net_amount", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-missing-net",
      sale_date: "2026-08-01",
      ship_country: "US",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-missing-net",
      order_id: "order-missing-net",
      order_date: "2026-08-01",
      gross_amount: 100,
      fees: 10,
      net_amount: null,
      currency: "USD",
      listing_currency: "USD",
    });

    const body = await run(db, "dateFrom=2026-08-01&dateTo=2026-08-31");

    expect(kpi(body, "net_usd_revenue")).toBeUndefined();
    expect(
      body.warnings.some((warning) => /unsupported currency, missing amount, or invalid exchange rate/i.test(warning)),
    ).toBe(true);
  });
});

describe("orders summary — margin KPI naming", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("names the margin KPI for what it measures, not 'true' margin", async () => {
    // The old key/label claimed "True Margin Rate", but the ratio is Gross Sales
    // vs Net Revenue and Net Revenue is after the Etsy payment processing fee
    // only — advertising, commission, listing renewals and VAT are not in it.
    // Those live in the Etsy ledger and cannot be split by this report's
    // country/coupon filters; the dashboard's True Net covers them.
    db = new TestD1();

    insertOrder(db, {
      order_id: "order-1",
      sale_date: "2026-03-10",
      ship_country: "US",
      currency: "USD",
      order_value: 100,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "pay-1",
      order_id: "order-1",
      order_date: "2026-03-10",
      gross_amount: 100,
      fees: 10,
      net_amount: 90,
      currency: "USD",
      listing_currency: "USD",
    });

    const body = await run(db, "dateFrom=2026-03-01&dateTo=2026-03-31");

    expect(kpi(body, "true_margin_rate")).toBeUndefined();
    const margin = body.kpis.find((item) => item.key === "payment_margin_rate") as
      | (Kpi & { label?: string })
      | undefined;
    expect(margin).toBeDefined();
    expect(margin?.label).toBe("Margin Rate (after payment fees)");
    expect(margin?.value).toBeCloseTo(0.9, 6);
  });
});

describe("orders summary provenance", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("returns csv_upload for CSV-only canonical rows", async () => {
    db = new TestD1();

    insertOrder(db, {
      order_id: "csv-order",
      sale_date: "2026-04-10",
      currency: "USD",
      order_value: 20,
      discount_amount: 0,
    });
    insertPayment(db, {
      payment_id: "csv-pay",
      order_id: "csv-order",
      order_date: "2026-04-10",
      gross_amount: 20,
      fees: 2,
      net_amount: 18,
      currency: "USD",
      listing_currency: "USD",
    });

    const response = await onRequestGet({
      request: request("dateFrom=2026-04-01&dateTo=2026-04-30&compare=none"),
      env: { DB: db },
    });
    const body = (await response.json()) as {
      provenance: { orders: string | null; payments: string | null };
    };

    expect(body.provenance.orders).toBe("csv_upload");
    expect(body.provenance.payments).toBe("csv_upload");
  });
});

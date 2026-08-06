import { afterEach, describe, expect, it } from "vitest";
import { insertOrder, insertPayment, TestD1 } from "../_testDb";
import { onRequestGet } from "./summary";

type Kpi = { key: string; label: string; value: number | string | null };

function request(query: string): Request {
  return new Request(`https://example.com/api/reports/payments/summary?compare=none&${query}`);
}

async function run(db: TestD1, query: string) {
  const response = await onRequestGet({ request: request(query), env: { DB: db } });
  return (await response.json()) as { kpis: Kpi[]; warnings: string[] };
}

function kpi(body: { kpis: Kpi[] }, key: string): Kpi | undefined {
  return body.kpis.find((item) => item.key === key);
}

describe("payments summary — normalized USD business metrics vs. raw settlement", () => {
  let db: TestD1;

  afterEach(() => {
    db?.sqlite.close();
  });

  it("converts Net Revenue (USD, normalized) with each row's own exchange rate, distinct from the raw TRY settlement KPI", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-02-10" });
    insertPayment(db, {
      payment_id: "pay-1",
      order_id: "order-1",
      order_date: "2026-02-10",
      gross_amount: 4000,
      fees: 400,
      net_amount: 3600,
      currency: "TRY",
      listing_currency: "USD",
      exchange_rate: 40,
    });

    const body = await run(db, "dateFrom=2026-02-01&dateTo=2026-02-28");

    // Raw settlement figure stays in TRY, unconverted, clearly labeled.
    const rawNetPayout = kpi(body, "total_net_payout_TRY");
    expect(rawNetPayout?.value).toBe(3600);
    expect(rawNetPayout?.label).toContain("Settlement");

    const rawFees = kpi(body, "total_fees_paid_TRY");
    expect(rawFees?.value).toBe(400);
    expect(rawFees?.label).toContain("Settlement");

    // Normalized business metric: converted with this row's own exchange_rate (40).
    expect(kpi(body, "net_revenue_usd")?.value).toBe(90);
    expect(kpi(body, "etsy_fees_usd")?.value).toBe(10);
  });

  it("marks the normalized USD metrics unavailable (not the raw settlement KPIs) when a row has no exchange rate", async () => {
    db = new TestD1();

    insertOrder(db, { order_id: "order-1", sale_date: "2026-03-10" });
    insertPayment(db, {
      payment_id: "pay-1",
      order_id: "order-1",
      order_date: "2026-03-10",
      gross_amount: 4000,
      fees: 400,
      net_amount: 3600,
      currency: "TRY",
      listing_currency: "USD",
      exchange_rate: null,
    });

    const body = await run(db, "dateFrom=2026-03-01&dateTo=2026-03-31");

    expect(kpi(body, "net_revenue_usd")).toBeUndefined();
    expect(kpi(body, "etsy_fees_usd")).toBeUndefined();
    // The raw settlement figure is still shown — it doesn't need FX to be TRY.
    expect(kpi(body, "total_net_payout_TRY")?.value).toBe(3600);
    expect(
      body.warnings.some((warning) => /USD Business Metrics.*unavailable/i.test(warning)),
    ).toBe(true);
  });
});

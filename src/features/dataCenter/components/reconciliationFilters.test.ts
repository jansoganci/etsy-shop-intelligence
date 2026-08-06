import { describe, expect, it } from "vitest";
import { filterMonthsForProblemsOnly } from "./reconciliationFilters";
import type { FinancialMetric, MonthlyFinancialEntry } from "../../../data/types/dataCenter";

function metric(overrides: Partial<FinancialMetric> = {}): FinancialMetric {
  return {
    key: "grossSales",
    label: "Gross Sales",
    businessBasis: "test",
    apiValue: 100,
    csvValue: 100,
    currency: "USD",
    difference: 0,
    differencePercentage: 0,
    status: "MATCHED",
    ...overrides,
  };
}

function month(overrides: Partial<MonthlyFinancialEntry> = {}): MonthlyFinancialEntry {
  return {
    month: "2026-06",
    orderCount: { api: 1, csv: 1 },
    paymentCount: { api: 1, csv: 1 },
    metrics: [metric()],
    status: "MATCHED",
    ...overrides,
  };
}

describe("filterMonthsForProblemsOnly", () => {
  it("drops a month whose every metric is MATCHED", () => {
    const months = [month({ metrics: [metric({ status: "MATCHED" }), metric({ key: "discount", status: "MATCHED" })] })];
    expect(filterMonthsForProblemsOnly(months)).toEqual([]);
  });

  it("keeps a month but only its non-MATCHED metrics when some, not all, have a problem", () => {
    const months = [
      month({
        metrics: [
          metric({ key: "grossSales", status: "MATCHED" }),
          metric({ key: "discount", status: "MISMATCH" }),
          metric({ key: "shipping", status: "WARNING" }),
        ],
      }),
    ];
    const result = filterMonthsForProblemsOnly(months);
    expect(result).toHaveLength(1);
    expect(result[0].metrics.map((m) => m.key)).toEqual(["discount", "shipping"]);
  });

  it("keeps a NOT_ENOUGH_DATA metric visible (it is not MATCHED, so it is a real gap to review)", () => {
    const months = [month({ metrics: [metric({ status: "NOT_ENOUGH_DATA" })] })];
    expect(filterMonthsForProblemsOnly(months)).toHaveLength(1);
  });

  it("does not mutate the original months array or its metric objects", () => {
    const original = month({ metrics: [metric({ status: "MISMATCH" }), metric({ key: "tax", status: "MATCHED" })] });
    const months = [original];
    const result = filterMonthsForProblemsOnly(months);
    expect(original.metrics).toHaveLength(2); // untouched
    expect(result[0]).not.toBe(original);
  });

  it("an empty months list stays empty", () => {
    expect(filterMonthsForProblemsOnly([])).toEqual([]);
  });
});

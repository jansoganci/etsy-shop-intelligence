import { describe, expect, it } from "vitest";
import {
  buildConvertedMetric,
  convertToReportingCurrency,
  deriveMetricStatus,
  deriveMonthStatus,
  deriveOverallMonthlyStatus,
  resolveConversion,
  summarizeConversionMethod,
  type FinancialMetric,
} from "./_financialReconciliation";

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

describe("deriveMetricStatus", () => {
  it("1. count equal, amount different => MISMATCH with the correct difference", () => {
    // doc Faz2 scenario: "Count eşit, amount farklı"
    const result = deriveMetricStatus(950, 900, "USD", "USD");
    expect(result.status).toBe("MISMATCH");
    expect(result.difference).toBe(50);
    expect(result.differencePercentage).toBeCloseTo((50 / 900) * 100, 6);
  });

  it("2. exact equality => MATCHED with zero difference", () => {
    const result = deriveMetricStatus(500, 500, "USD", "USD");
    expect(result.status).toBe("MATCHED");
    expect(result.difference).toBe(0);
  });

  it("3. small rounding difference within tolerance => WARNING, not MISMATCH", () => {
    const result = deriveMetricStatus(29.74, 29.75, "USD", "USD");
    expect(result.status).toBe("WARNING");
    expect(result.difference).toBeCloseTo(-0.01, 8);
  });

  it("4. difference beyond tolerance => MISMATCH", () => {
    const result = deriveMetricStatus(30.5, 29.75, "USD", "USD");
    expect(result.status).toBe("MISMATCH");
  });

  it("5. either side missing a value => NOT_ENOUGH_DATA, not a false MATCHED/MISMATCH", () => {
    expect(deriveMetricStatus(null, 900, "USD", "USD").status).toBe("NOT_ENOUGH_DATA");
    expect(deriveMetricStatus(900, null, "USD", "USD").status).toBe("NOT_ENOUGH_DATA");
  });

  it("6. currency missing or differing => NOT_ENOUGH_DATA, amounts are not cross-compared", () => {
    // Business-basis guard: never silently compare different currencies as if equal.
    expect(deriveMetricStatus(100, 100, "USD", "TRY").status).toBe("NOT_ENOUGH_DATA");
    expect(deriveMetricStatus(100, 100, null, "USD").status).toBe("NOT_ENOUGH_DATA");
    expect(deriveMetricStatus(100, 100, "USD", null).status).toBe("NOT_ENOUGH_DATA");
  });

  it("7. amount equal, currency equal => MATCHED even for a multi-item receipt total", () => {
    // doc Faz2 scenario: "Çok item'lı receipt" -- this module only sees
    // pre-aggregated sums, so equal aggregate sums must read as MATCHED
    // regardless of how many underlying line items composed them.
    const result = deriveMetricStatus(1234.56, 1234.56, "USD", "USD");
    expect(result.status).toBe("MATCHED");
  });

  it("8. custom tolerance is respected", () => {
    expect(deriveMetricStatus(10.1, 10, "USD", "USD", 0.2).status).toBe("WARNING");
    expect(deriveMetricStatus(10.3, 10, "USD", "USD", 0.2).status).toBe("MISMATCH");
  });
});

describe("deriveMonthStatus", () => {
  it("ignores the VAT stub (CSV has no VAT column, structurally unavailable forever) when rolling up a month's status", () => {
    const metrics = [
      metric({ key: "grossSales", status: "MATCHED" }),
      metric({ key: "discount", status: "MATCHED" }),
      metric({ key: "vat", status: "NOT_ENOUGH_DATA", csvValue: null, currency: null }),
    ];
    expect(deriveMonthStatus(metrics)).toBe("MATCHED");
  });

  it("refund is no longer a stub after migration 0013: a matched refund keeps the month MATCHED", () => {
    const metrics = [
      metric({ key: "grossSales", status: "MATCHED" }),
      metric({ key: "refund", status: "MATCHED", apiValue: 0, csvValue: 0 }),
    ];
    expect(deriveMonthStatus(metrics)).toBe("MATCHED");
  });

  it("refund is no longer a stub: an unavailable refund comparison now correctly downgrades the month", () => {
    // Before migration 0013, "refund" was a permanent stub so this would have
    // stayed MATCHED. Now that refund data can genuinely be compared, a real
    // NOT_ENOUGH_DATA on it should surface, not be silently swallowed.
    const metrics = [
      metric({ key: "grossSales", status: "MATCHED" }),
      metric({ key: "refund", status: "NOT_ENOUGH_DATA", apiValue: null, csvValue: null, currency: null }),
    ];
    expect(deriveMonthStatus(metrics)).toBe("NOT_ENOUGH_DATA");
  });

  it("9. amount equal in aggregate but underlying entities disagree is out of Phase 2 scope, "
    + "so a real core mismatch still wins over stub NOT_ENOUGH_DATA", () => {
    const metrics = [
      metric({ key: "grossSales", status: "MISMATCH" }),
      metric({ key: "vat", status: "NOT_ENOUGH_DATA" }),
    ];
    expect(deriveMonthStatus(metrics)).toBe("MISMATCH");
  });

  it("NOT_ENOUGH_DATA outranks WARNING so an incomplete month cannot pass cutover", () => {
    expect(
      deriveMonthStatus([metric({ status: "WARNING" }), metric({ key: "shipping", status: "NOT_ENOUGH_DATA" })]),
    ).toBe("NOT_ENOUGH_DATA");
    expect(
      deriveMonthStatus([metric({ status: "WARNING" }), metric({ key: "shipping", status: "MISMATCH" })]),
    ).toBe("MISMATCH");
  });

  it("a month with only stub metrics has no comparable core data => NOT_ENOUGH_DATA", () => {
    const metrics = [metric({ key: "vat", status: "NOT_ENOUGH_DATA" })];
    expect(deriveMonthStatus(metrics)).toBe("NOT_ENOUGH_DATA");
  });
});

// -----------------------------------------------------------------------
// Phase 3: currency conversion. Doc's Faz3 test list: same currency,
// TRY/USD valid rate, missing/zero/negative rate, currency mismatch, rate
// rounding.
// -----------------------------------------------------------------------

describe("resolveConversion", () => {
  it("same currency (USD) => identity, rate 1, no rate lookup needed", () => {
    const result = resolveConversion("USD", "USD", null);
    expect(result).toEqual({ method: "identity", rate: 1 });
  });

  it("same currency is case-insensitive and tolerates whitespace", () => {
    expect(resolveConversion(" usd ", "usd", null)).toEqual({ method: "identity", rate: 1 });
  });

  it("TRY/USD with a valid positive row rate => csv_row_rate, using that exact rate", () => {
    const result = resolveConversion("TRY", "USD", 40.5);
    expect(result).toEqual({ method: "csv_row_rate", rate: 40.5 });
  });

  it("missing rate (null) on a TRY/USD row => unavailable, EXCHANGE_RATE_MISSING, never invents a rate", () => {
    const result = resolveConversion("TRY", "USD", null);
    expect(result.method).toBe("unavailable");
    expect(result.rate).toBeNull();
    expect(result.reasonCode).toBe("EXCHANGE_RATE_MISSING");
  });

  it("zero rate => unavailable, EXCHANGE_RATE_MISSING (never divide by zero)", () => {
    const result = resolveConversion("TRY", "USD", 0);
    expect(result.method).toBe("unavailable");
    expect(result.reasonCode).toBe("EXCHANGE_RATE_MISSING");
  });

  it("negative rate => unavailable, EXCHANGE_RATE_MISSING (a negative rate is not a usable rate)", () => {
    const result = resolveConversion("TRY", "USD", -40);
    expect(result.method).toBe("unavailable");
    expect(result.reasonCode).toBe("EXCHANGE_RATE_MISSING");
  });

  it("currency mismatch outside the one supported pair (e.g. EUR) => unavailable, UNSUPPORTED_CURRENCY_PAIR", () => {
    const result = resolveConversion("EUR", "USD", 1.1);
    expect(result.method).toBe("unavailable");
    expect(result.reasonCode).toBe("UNSUPPORTED_CURRENCY_PAIR");
  });

  it("TRY against a non-USD listing currency is not the supported pair => UNSUPPORTED_CURRENCY_PAIR", () => {
    const result = resolveConversion("TRY", "EUR", 40);
    expect(result.reasonCode).toBe("UNSUPPORTED_CURRENCY_PAIR");
  });

  it("missing currency entirely => unavailable, EXCHANGE_RATE_MISSING", () => {
    const result = resolveConversion(null, "USD", null);
    expect(result.method).toBe("unavailable");
    expect(result.reasonCode).toBe("EXCHANGE_RATE_MISSING");
  });
});

describe("convertToReportingCurrency", () => {
  it("identity conversion returns the amount unchanged", () => {
    expect(convertToReportingCurrency(100, "USD", "USD", null)).toEqual({
      valueUsd: 100,
      method: "identity",
    });
  });

  it("csv_row_rate divides by the exact row rate (rounding is not applied here; only tolerance later is)", () => {
    const result = convertToReportingCurrency(4050, "TRY", "USD", 40.5);
    expect(result.method).toBe("csv_row_rate");
    expect(result.valueUsd).toBeCloseTo(100, 10);
  });

  it("a rate that does not evenly divide still converts to full precision, no premature rounding", () => {
    const result = convertToReportingCurrency(100, "TRY", "USD", 3);
    expect(result.method).toBe("csv_row_rate");
    expect(result.valueUsd).toBeCloseTo(33.333333333333336, 10);
  });

  it("unconvertible input amount => unavailable, no value invented", () => {
    expect(convertToReportingCurrency(null, "USD", "USD", null).valueUsd).toBeNull();
    expect(convertToReportingCurrency(Number.NaN, "USD", "USD", null).valueUsd).toBeNull();
  });

  it("unsupported pair => null value, not zero and not the raw untouched amount", () => {
    const result = convertToReportingCurrency(100, "EUR", "USD", null);
    expect(result.valueUsd).toBeNull();
    expect(result.method).toBe("unavailable");
  });
});

describe("summarizeConversionMethod", () => {
  it("all rows identity => identity", () => {
    expect(summarizeConversionMethod(10, 0, 0)).toBe("identity");
  });

  it("all rows csv_row_rate => csv_row_rate", () => {
    expect(summarizeConversionMethod(0, 10, 0)).toBe("csv_row_rate");
  });

  it("a mix of identity and csv_row_rate rows => mixed", () => {
    expect(summarizeConversionMethod(5, 5, 0)).toBe("mixed");
  });

  it("any unconvertible rows alongside convertible ones => mixed (partial data, must not read as clean)", () => {
    expect(summarizeConversionMethod(8, 0, 2)).toBe("mixed");
  });

  it("every row unconvertible => unavailable", () => {
    expect(summarizeConversionMethod(0, 0, 5)).toBe("unavailable");
  });

  it("no rows at all => unavailable", () => {
    expect(summarizeConversionMethod(0, 0, 0)).toBe("unavailable");
  });
});

describe("buildConvertedMetric", () => {
  it("never reports a partial total as MATCHED when an unconvertible row was excluded", () => {
    const result = buildConvertedMetric(
      "paymentGrossOriginal",
      "Payment Gross",
      "test",
      100,
      100,
      { identity: 1, csvRate: 0, unconvertible: 1 },
      { identity: 2, csvRate: 0, unconvertible: 0 },
    );
    expect(result.status).toBe("NOT_ENOUGH_DATA");
    expect(result.difference).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.reason).toContain("excluded");
  });
});

describe("deriveOverallMonthlyStatus", () => {
  it("mismatch in any month wins over the rest", () => {
    expect(deriveOverallMonthlyStatus(["MATCHED", "MISMATCH", "WARNING"])).toBe("MISMATCH");
  });

  it("not-enough-data wins over warning so incomplete periods block cutover", () => {
    expect(deriveOverallMonthlyStatus(["MATCHED", "NOT_ENOUGH_DATA", "WARNING"])).toBe("NOT_ENOUGH_DATA");
  });

  it("all matched months roll up to MATCHED", () => {
    expect(deriveOverallMonthlyStatus(["MATCHED", "MATCHED"])).toBe("MATCHED");
  });

  it("no months at all => NOT_ENOUGH_DATA", () => {
    expect(deriveOverallMonthlyStatus([])).toBe("NOT_ENOUGH_DATA");
  });
});

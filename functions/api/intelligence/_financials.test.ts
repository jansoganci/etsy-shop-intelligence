import { describe, expect, it } from "vitest";
import {
  assessCurrency,
  buildFinancialQualityWarnings,
  calculateGrossSales,
  countCoveredOrders,
  requirePaymentCoverage,
  summarizePaymentFinancials,
  type PaymentFinancialRow,
} from "./_financials";

function csvRow(overrides: Partial<PaymentFinancialRow> = {}): PaymentFinancialRow {
  return {
    orderId: "order-1",
    grossAmount: 100,
    fees: 10,
    netAmount: 90,
    exchangeRate: 40,
    paymentCurrency: "TRY",
    listingCurrency: "USD",
    dataSource: "csv_upload",
    ...overrides,
  };
}

function apiRow(overrides: Partial<PaymentFinancialRow> = {}): PaymentFinancialRow {
  return {
    orderId: "order-1",
    grossAmount: 100,
    fees: 10,
    netAmount: 90,
    exchangeRate: null,
    paymentCurrency: "USD",
    listingCurrency: "USD",
    dataSource: "etsy_api",
    ...overrides,
  };
}

describe("gross sales", () => {
  it("subtracts discounts from list value", () => {
    expect(calculateGrossSales(443.37, 224.56)).toBeCloseTo(218.81, 8);
  });

  it("treats a missing discount as zero", () => {
    expect(calculateGrossSales(10.99, null)).toBe(10.99);
  });

  it("uses Etsy's pre-discount total_price, not the post-discount grandtotal", () => {
    // A representative Etsy receipt: two items at $12.99 + $9.99 = $22.98 (total_price,
    // pre-discount "list value"), a $5 discount, $2 shipping, $1.50 tax.
    const totalPrice = 22.98;
    const discount = 5;
    const shipping = 2;
    const tax = 1.5;
    const subtotal = totalPrice - discount; // Etsy semantics: subtotal = total_price - discount
    const grandtotal = subtotal + tax + shipping; // Etsy semantics: grandtotal = subtotal + tax + shipping

    // Correct (Phase 1) mapping: order_value = total_price, so Gross Sales = subtotal exactly.
    expect(calculateGrossSales(totalPrice, discount)).toBeCloseTo(subtotal, 8);

    // The bug this migration fixes: feeding grandtotal in as order_value double-subtracts
    // the discount and pulls in tax/shipping. Documented here so nobody reintroduces it.
    const buggyResult = calculateGrossSales(grandtotal, discount);
    expect(buggyResult).not.toBeCloseTo(subtotal, 2);
    expect(buggyResult).toBeCloseTo(totalPrice - 2 * discount + tax + shipping, 8);
  });
});

describe("period financial quality", () => {
  it("checks current, previous, and previous-year periods independently", () => {
    const validPayments = requirePaymentCoverage(summarizePaymentFinancials([csvRow()]), 1, 1);
    const warnings = buildFinancialQualityWarnings([
      {
        label: "selected",
        orders: 1,
        orderCurrency: assessCurrency(["USD", "EUR"], 0),
        payments: validPayments,
      },
      {
        label: "previous",
        orders: 1,
        orderCurrency: assessCurrency(["USD"], 0),
        payments: requirePaymentCoverage(summarizePaymentFinancials([]), 1, 0),
      },
      {
        label: "previous-year",
        orders: 1,
        orderCurrency: assessCurrency(["USD"], 0),
        payments: requirePaymentCoverage(
          summarizePaymentFinancials([csvRow({ exchangeRate: null })]),
          1,
          1,
        ),
      },
    ]);

    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("selected period Gross Sales");
    expect(warnings[1]).toContain("covers 0 of 1 selected orders");
    expect(warnings[2]).toContain("previous-year period has 1 payment row");
  });

  it("warns when a discount currency was withheld", () => {
    const warnings = buildFinancialQualityWarnings([
      {
        label: "commerce period",
        orders: 1,
        orderCurrency: assessCurrency(["USD"], 0),
        discountWithheldRows: 1,
        payments: requirePaymentCoverage(summarizePaymentFinancials([csvRow()]), 1, 1),
      },
    ]);
    expect(warnings.some((warning) => warning.includes("discount currency disagreed"))).toBe(
      true,
    );
  });
});

describe("canonical order currency", () => {
  it("accepts a complete USD-only period", () => {
    expect(assessCurrency(["USD"], 0)).toMatchObject({ valid: true });
  });

  it("rejects mixed, missing, or non-USD currencies", () => {
    expect(assessCurrency(["USD", "EUR"], 0).valid).toBe(false);
    expect(assessCurrency(["USD"], 1).valid).toBe(false);
    expect(assessCurrency(["EUR"], 0).valid).toBe(false);
  });
});

describe("payment financial normalization (CSV source, unchanged behavior)", () => {
  it("converts every payment row with its own exchange rate", () => {
    const result = summarizePaymentFinancials([
      csvRow({ grossAmount: 100, fees: 10, netAmount: 90, exchangeRate: 40 }),
      csvRow({ grossAmount: 210, fees: 21, netAmount: 189, exchangeRate: 42 }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.paymentGrossUsd).toBeCloseTo(7.5, 8);
    expect(result.etsyFeesUsd).toBeCloseTo(0.75, 8);
    expect(result.netRevenueUsd).toBeCloseTo(6.75, 8);
    expect(result.reconciliationDeltaUsd).toBeCloseTo(0, 8);
  });

  it("invalidates the total instead of silently dropping a bad row", () => {
    const result = summarizePaymentFinancials([csvRow({ exchangeRate: 0 })]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
    expect(result.etsyFeesUsd).toBeNull();
    expect(result.netRevenueUsd).toBeNull();
  });

  it("rejects a CSV row with a missing (null) exchange rate", () => {
    const result = summarizePaymentFinancials([csvRow({ exchangeRate: null })]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
    expect(result.paymentGrossUsd).toBeNull();
  });

  it("rejects a CSV row with a missing net_amount", () => {
    const result = summarizePaymentFinancials([csvRow({ netAmount: null })]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
    expect(result.netRevenueUsd).toBeNull();
  });

  it("accepts a CSV-sourced USD row with identity conversion (no exchange rate needed)", () => {
    const result = summarizePaymentFinancials([
      csvRow({ paymentCurrency: "USD", listingCurrency: "USD", exchangeRate: null }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.invalidRowCount).toBe(0);
    expect(result.paymentGrossUsd).toBe(100);
  });
});

describe("payment financial normalization (Etsy API source)", () => {
  it("accepts a USD/USD API row with identity conversion (rate 1, no exchange_rate needed)", () => {
    const result = summarizePaymentFinancials([
      apiRow({ grossAmount: 100, fees: 10, netAmount: 90 }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.paymentGrossUsd).toBeCloseTo(100, 8);
    expect(result.etsyFeesUsd).toBeCloseTo(10, 8);
    expect(result.netRevenueUsd).toBeCloseTo(90, 8);
  });

  it("accepts a USD API payment even when a mixed-currency receipt has no single listing currency", () => {
    const result = summarizePaymentFinancials([
      apiRow({ paymentCurrency: "USD", listingCurrency: null }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.paymentGrossUsd).toBe(100);
  });

  it("marks a TRY/TRY API row unavailable for USD reporting (no authoritative rate)", () => {
    const result = summarizePaymentFinancials([
      apiRow({ paymentCurrency: "TRY", listingCurrency: "TRY" }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
    expect(result.paymentGrossUsd).toBeNull();
  });

  it("marks an Etsy API cross-currency row (TRY payment, USD listing) unavailable when no exchange_rate", () => {
    const result = summarizePaymentFinancials([
      apiRow({ paymentCurrency: "TRY", listingCurrency: "USD", exchangeRate: null }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
  });

  it("converts a non-USD API payment when a CSV-backed exchange rate is present", () => {
    const result = summarizePaymentFinancials([
      apiRow({
        grossAmount: 2000,
        fees: 200,
        netAmount: 1800,
        paymentCurrency: "TRY",
        listingCurrency: "USD",
        exchangeRate: 40,
      }),
    ]);

    expect(result.valid).toBe(true);
    expect(result.paymentGrossUsd).toBeCloseTo(50, 8);
    expect(result.etsyFeesUsd).toBeCloseTo(5, 8);
    expect(result.netRevenueUsd).toBeCloseTo(45, 8);
  });

  it("rejects a non-USD API payment without a rate even when source is etsy_api", () => {
    const result = summarizePaymentFinancials([
      apiRow({ paymentCurrency: "TRY", listingCurrency: "USD", exchangeRate: null }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
    expect(result.paymentGrossUsd).toBeNull();
  });

  it("rejects unsupported currency pairs even when a stray exchangeRate is present", () => {
    const result = summarizePaymentFinancials([
      apiRow({ paymentCurrency: "EUR", listingCurrency: "EUR", exchangeRate: 1.1 }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.invalidRowCount).toBe(1);
  });

  it("converts an etsy_api+csv enriched row with TRY/USD and a finite rate", () => {
    const result = summarizePaymentFinancials([
      {
        orderId: "order-1",
        grossAmount: 2000,
        fees: 200,
        netAmount: 1800,
        exchangeRate: 40,
        paymentCurrency: "TRY",
        listingCurrency: "USD",
        dataSource: "etsy_api+csv",
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.paymentGrossUsd).toBeCloseTo(50, 8);
    expect(result.etsyFeesUsd).toBeCloseTo(5, 8);
    expect(result.netRevenueUsd).toBeCloseTo(45, 8);
  });

  it("treats API and CSV rows the same when rate availability matches", () => {
    const shape = {
      grossAmount: 2000,
      fees: 200,
      netAmount: 1800,
      exchangeRate: 40,
      paymentCurrency: "TRY",
      listingCurrency: "USD",
    };

    const apiResult = summarizePaymentFinancials([{ ...shape, dataSource: "etsy_api" }]);
    const csvResult = summarizePaymentFinancials([{ ...shape, dataSource: "csv_upload" }]);
    const enrichedResult = summarizePaymentFinancials([{ ...shape, dataSource: "etsy_api+csv" }]);

    expect(apiResult.valid).toBe(true);
    expect(csvResult.valid).toBe(true);
    expect(enrichedResult.valid).toBe(true);
    expect(apiResult.netRevenueUsd).toBeCloseTo(csvResult.netRevenueUsd!, 8);
    expect(enrichedResult.netRevenueUsd).toBeCloseTo(csvResult.netRevenueUsd!, 8);
  });
});

describe("requirePaymentCoverage", () => {
  it("forces a $0 total to unavailable when orders exist but zero payment rows matched", () => {
    const emptySummary = summarizePaymentFinancials([]);
    expect(emptySummary.valid).toBe(true);
    expect(emptySummary.netRevenueUsd).toBe(0);

    const result = requirePaymentCoverage(emptySummary, 5, 0);

    expect(result.valid).toBe(false);
    expect(result.coveredOrderCount).toBe(0);
    expect(result.expectedOrderCount).toBe(5);
    expect(result.netRevenueUsd).toBeNull();
    expect(result.paymentGrossUsd).toBeNull();
    expect(result.etsyFeesUsd).toBeNull();
    expect(result.reconciliationDeltaUsd).toBeNull();
  });

  it("invalidates partial coverage (payments for only some selected orders)", () => {
    const rows = [
      csvRow({ orderId: "order-1" }),
      csvRow({ orderId: "order-2" }),
      // two payment rows for order-1 still count as one covered order
      csvRow({ orderId: "order-1", grossAmount: 50, fees: 5, netAmount: 45 }),
    ];
    const summary = summarizePaymentFinancials(rows);
    expect(summary.valid).toBe(true);

    const result = requirePaymentCoverage(summary, 10, countCoveredOrders(rows));

    expect(result.coveredOrderCount).toBe(2);
    expect(result.expectedOrderCount).toBe(10);
    expect(result.valid).toBe(false);
    expect(result.netRevenueUsd).toBeNull();
  });

  it("accepts complete coverage when one order has multiple valid payment rows", () => {
    const rows = [
      csvRow({ orderId: "order-1", grossAmount: 100, fees: 10, netAmount: 90 }),
      csvRow({ orderId: "order-1", grossAmount: 50, fees: 5, netAmount: 45 }),
    ];
    const summary = summarizePaymentFinancials(rows);
    const covered = countCoveredOrders(rows);

    expect(covered).toBe(1);
    expect(summary.paymentRowCount).toBe(2);

    const result = requirePaymentCoverage(summary, 1, covered);

    expect(result.valid).toBe(true);
    expect(result.netRevenueUsd).toBeCloseTo(3.375, 8); // (90+45)/40
    expect(result.coveredOrderCount).toBe(1);
    expect(result.expectedOrderCount).toBe(1);
  });

  it("leaves a zero-orders cohort alone (nothing to cover)", () => {
    const emptySummary = summarizePaymentFinancials([]);
    const result = requirePaymentCoverage(emptySummary, 0, 0);

    expect(result.valid).toBe(true);
    expect(result.netRevenueUsd).toBe(0);
  });

  it("passes through unchanged when every selected order has payment coverage", () => {
    const rows = [
      csvRow({ orderId: "a" }),
      csvRow({ orderId: "b" }),
      csvRow({ orderId: "c" }),
    ];
    const summary = summarizePaymentFinancials(rows);
    const result = requirePaymentCoverage(summary, 3, countCoveredOrders(rows));

    expect(result.valid).toBe(true);
    expect(result.netRevenueUsd).toBe(summary.netRevenueUsd);
  });

  it("counts coverage only among selected order IDs when a set is provided", () => {
    const rows = [
      csvRow({ orderId: "selected-1" }),
      csvRow({ orderId: "outside-cohort" }),
    ];
    const selected = new Set(["selected-1"]);

    expect(countCoveredOrders(rows, selected)).toBe(1);
    expect(countCoveredOrders(rows)).toBe(2);
  });
});

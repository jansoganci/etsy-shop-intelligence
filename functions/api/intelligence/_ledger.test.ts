import { describe, expect, it } from "vitest";
import {
  bridgeOtherEtsyCosts,
  buildRateLookup,
  ledgerBalanceReconciles,
  summarizeLedger,
  type LedgerEntryRow,
  type LedgerRateRow,
} from "./_ledger";

const RATES: LedgerRateRow[] = [
  { rateDate: "2026-05-01", settlementPerUsd: 44 },
  { rateDate: "2026-05-10", settlementPerUsd: 40 },
  { rateDate: "2026-05-20", settlementPerUsd: 45 },
];

function entry(overrides: Partial<LedgerEntryRow> = {}): LedgerEntryRow {
  return {
    entryDate: "2026-05-10",
    category: "ads",
    entryCurrency: "TRY",
    amountTry: -180,
    ...overrides,
  };
}

describe("buildRateLookup", () => {
  it("uses the day's own rate", () => {
    expect(buildRateLookup(RATES)("2026-05-10")).toBe(40);
  });

  it("carries the last known rate forward across days with no sale", () => {
    // Advertising is charged daily; 6 of 31 days in 2026-05 had no payment.
    expect(buildRateLookup(RATES)("2026-05-12")).toBe(40);
    expect(buildRateLookup(RATES)("2026-05-19")).toBe(40);
    expect(buildRateLookup(RATES)("2026-05-21")).toBe(45);
  });

  it("returns null before the first rate, never extrapolating backwards", () => {
    // Production has 32 ledger rows from 2024-12-18 that predate the first
    // payment on 2025-01-17.
    expect(buildRateLookup(RATES)("2026-04-30")).toBeNull();
  });

  it("ignores zero, negative and missing rates", () => {
    const lookup = buildRateLookup([
      { rateDate: "2026-05-01", settlementPerUsd: 44 },
      { rateDate: "2026-05-05", settlementPerUsd: 0 },
      { rateDate: "2026-05-06", settlementPerUsd: null },
    ]);
    expect(lookup("2026-05-07")).toBe(44);
  });

  it("returns null when there are no rates at all", () => {
    expect(buildRateLookup([])("2026-05-10")).toBeNull();
  });
});

describe("summarizeLedger", () => {
  it("totals each category in USD", () => {
    const summary = summarizeLedger(
      [
        entry({ category: "sales_gross", amountTry: 400 }),
        entry({ category: "fee_processing", amountTry: -40 }),
        entry({ category: "ads", amountTry: -80 }),
      ],
      RATES,
    );

    expect(summary.categoryUsd.sales_gross).toBeCloseTo(10, 8);
    expect(summary.categoryUsd.fee_processing).toBeCloseTo(-1, 8);
    expect(summary.categoryUsd.ads).toBeCloseTo(-2, 8);
    expect(summary.unconvertibleCount).toBe(0);
  });

  it("True Net excludes bank disbursements and card funding", () => {
    const summary = summarizeLedger(
      [
        entry({ category: "sales_gross", amountTry: 400 }),
        entry({ category: "fee_processing", amountTry: -40 }),
        entry({ category: "ads", amountTry: -80 }),
        entry({ category: "disbursement", amountTry: -200 }),
        entry({ category: "funding", amountTry: 60 }),
      ],
      RATES,
    );

    // 10.00 - 1.00 - 2.00; the -5.00 disbursement and +1.50 funding are moves.
    expect(summary.trueNetUsd).toBeCloseTo(7, 8);
    expect(summary.categoryUsd.disbursement).toBeCloseTo(-5, 8);
  });

  it("marks the period unavailable when any row cannot be converted", () => {
    const summary = summarizeLedger(
      [
        entry({ category: "sales_gross", amountTry: 400 }),
        entry({ entryDate: "2026-04-30", amountTry: -80 }), // before the first rate
      ],
      RATES,
    );

    expect(summary.unconvertibleCount).toBe(1);
    expect(summary.trueNetUsd).toBeNull();
    expect(summary.categoryUsd).toEqual({});
  });

  it("never divides a non-TRY entry by the TRY rate", () => {
    const summary = summarizeLedger([entry({ entryCurrency: "EUR" })], RATES);

    expect(summary.unconvertibleCount).toBe(1);
    expect(summary.trueNetUsd).toBeNull();
  });

  it("counts rows whose ledger_type is not mapped yet", () => {
    const summary = summarizeLedger(
      [entry({ category: "other", amountTry: -10 }), entry({ category: null, amountTry: -10 })],
      RATES,
    );

    expect(summary.otherCategoryCount).toBe(2);
    expect(summary.categoryUsd.other).toBeCloseTo(-0.5, 8);
  });

  it("reports TRY movement over every row, convertible or not", () => {
    const summary = summarizeLedger(
      [
        entry({ amountTry: 400 }),
        entry({ entryDate: "2026-04-30", amountTry: -100 }), // unconvertible
      ],
      RATES,
    );

    expect(summary.movementTry).toBeCloseTo(300, 8);
    expect(summary.entryCount).toBe(2);
  });

  it("an empty period is zero, not unavailable", () => {
    const summary = summarizeLedger([], RATES);
    expect(summary.trueNetUsd).toBe(0);
    expect(summary.unconvertibleCount).toBe(0);
  });
});

describe("bridgeOtherEtsyCosts", () => {
  it("makes the dashboard chain add up exactly", () => {
    // Production 2026-05: net 344.68, ads -72.00, true net 187.77.
    const other = bridgeOtherEtsyCosts(344.68, -72, 187.77);
    expect(other).toBeCloseTo(-84.91, 6);
    expect(344.68 + -72 + (other as number)).toBeCloseTo(187.77, 6);
  });

  it("absorbs a refund month's gap instead of leaving it visible on screen", () => {
    // Production 2026-04: the literal fee categories sum to -85.57, but the
    // ledger's true net is 3.55 lower because it reverses the refund.
    const other = bridgeOtherEtsyCosts(332.28, -62.12, 181.04);
    expect(other).toBeCloseTo(-89.12, 6);
    expect(332.28 + -62.12 + (other as number)).toBeCloseTo(181.04, 6);
  });

  it("is null when any input is unavailable", () => {
    expect(bridgeOtherEtsyCosts(null, -72, 187.77)).toBeNull();
    expect(bridgeOtherEtsyCosts(344.68, null, 187.77)).toBeNull();
    expect(bridgeOtherEtsyCosts(344.68, -72, null)).toBeNull();
  });
});

describe("ledgerBalanceReconciles", () => {
  it("accepts the production 2026-05 movement", () => {
    // closing 7,438.73 - opening 6,307.23 = 1,131.50
    expect(ledgerBalanceReconciles(1131.5, 6307.23, 7438.73)).toBe(true);
  });

  it("rejects a movement that does not match the balance chain", () => {
    expect(ledgerBalanceReconciles(1000, 6307.23, 7438.73)).toBe(false);
  });

  it("rejects a missing balance rather than assuming it reconciles", () => {
    expect(ledgerBalanceReconciles(1131.5, null, 7438.73)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeSyncProgress,
  commerceStageLabel,
  isFutureUtcDate,
  previousUtcMonths,
  thisUtcMonth,
  utcMonthPeriod,
  validateCommercePeriodInput,
} from "./commercePeriod";

const FIXED_NOW = new Date("2026-08-05T15:30:00.000Z");

describe("utcMonthPeriod / thisUtcMonth / previousUtcMonths", () => {
  it("maps a month shortcut to inclusive UTC from/to dates", () => {
    expect(utcMonthPeriod(2026, 7)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(thisUtcMonth(FIXED_NOW)).toEqual({
      from: "2026-08-01",
      to: "2026-08-05",
    });
    expect(previousUtcMonths(2, FIXED_NOW)).toEqual([
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-06-01", to: "2026-06-30" },
    ]);
  });
});

describe("validateCommercePeriodInput", () => {
  it("rejects future UTC dates", () => {
    expect(validateCommercePeriodInput("2026-08-06", "2026-08-06", FIXED_NOW)).toEqual({
      ok: false,
      error: "future_date",
    });
    expect(isFutureUtcDate("2026-08-06", FIXED_NOW)).toBe(true);
    expect(isFutureUtcDate("2026-08-05", FIXED_NOW)).toBe(false);
  });

  it("rejects a reversed UTC range", () => {
    expect(validateCommercePeriodInput("2026-08-05", "2026-08-01", FIXED_NOW)).toEqual({
      ok: false,
      error: "reversed_range",
    });
  });
});

describe("computeSyncProgress", () => {
  it("returns 0 when completed and total are both zero", () => {
    expect(computeSyncProgress(0, 0)).toBe(0);
    expect(Number.isNaN(computeSyncProgress(0, 0))).toBe(false);
  });

  it("caps the ratio at 1", () => {
    expect(computeSyncProgress(12, 10)).toBe(1);
  });
});

describe("commerceStageLabel", () => {
  it("maps known stages to Turkish labels", () => {
    expect(commerceStageLabel("receipts")).toBe("Siparişler");
    expect(commerceStageLabel("finishing")).toBe("Tamamlanıyor");
  });
});

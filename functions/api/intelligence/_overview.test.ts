import { describe, expect, it } from "vitest";
import {
  buildPeriodRanges,
  calculateStability,
  classifyShopStatus,
  resolveDefaultMonth,
} from "./_overview";

describe("overview period ranges", () => {
  it("defaults to the previous month when current-month data is partial", () => {
    expect(resolveDefaultMonth("2026-07-23", new Date("2026-07-23T12:00:00Z"))).toBe("2026-06");
  });

  it("uses full equal months for a completed month", () => {
    const ranges = buildPeriodRanges("2026-06", "2026-07-23", new Date("2026-07-23T12:00:00Z"));

    expect(ranges.current).toMatchObject({ from: "2026-06-01", to: "2026-06-30", isPartial: false });
    expect(ranges.previous).toMatchObject({ from: "2026-05-01", to: "2026-05-31" });
    expect(ranges.previousYear).toMatchObject({ from: "2025-06-01", to: "2025-06-30" });
  });

  it("aligns partial months by day number", () => {
    const ranges = buildPeriodRanges("2026-07", "2026-07-23", new Date("2026-07-23T12:00:00Z"));

    expect(ranges.current).toMatchObject({ from: "2026-07-01", to: "2026-07-23", isPartial: true });
    expect(ranges.previous).toMatchObject({ from: "2026-06-01", to: "2026-06-23" });
    expect(ranges.previousYear).toMatchObject({ from: "2025-07-01", to: "2025-07-23" });
  });
});

describe("stability calculations", () => {
  it("counts zero days, target-band days, and the longest zero streak", () => {
    const stability = calculateStability([
      { date: "2026-06-01", orderCount: 0, grossSales: 0 },
      { date: "2026-06-02", orderCount: 0, grossSales: 0 },
      { date: "2026-06-03", orderCount: 4, grossSales: 10 },
      { date: "2026-06-04", orderCount: 3, grossSales: 10 },
      { date: "2026-06-05", orderCount: 1, grossSales: 10 },
    ]);

    expect(stability.zeroSalesDays).toBe(2);
    expect(stability.targetBandDays).toBe(2);
    expect(stability.longestZeroSalesStreak).toBe(2);
    expect(stability.activeDayRate).toBe(0.6);
  });
});

describe("shop status", () => {
  it("classifies material dual-period decline", () => {
    expect(classifyShopStatus(-0.2, -0.12)).toBe("declining");
  });

  it("keeps small changes stable", () => {
    expect(classifyShopStatus(-0.03, 0.04)).toBe("stable");
  });
});

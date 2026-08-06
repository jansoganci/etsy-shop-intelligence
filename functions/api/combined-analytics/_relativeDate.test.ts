import { describe, expect, it } from "vitest";
import { resolveGaDateRange } from "./_relativeDate";

const ANCHOR = "2026-07-26 23:57:37";

describe("resolveGaDateRange", () => {
  it("resolves NdaysAgo relative to the anchor", () => {
    const result = resolveGaDateRange("30daysAgo", "today", ANCHOR);

    expect(result).toEqual({ from: "2026-06-26", to: "2026-07-26" });
  });

  it("resolves today", () => {
    const result = resolveGaDateRange("today", "today", ANCHOR);

    expect(result).toEqual({ from: "2026-07-26", to: "2026-07-26" });
  });

  it("resolves yesterday", () => {
    const result = resolveGaDateRange("yesterday", "today", ANCHOR);

    expect(result).toEqual({ from: "2026-07-25", to: "2026-07-26" });
  });

  it("passes through an already-ISO date unchanged", () => {
    const result = resolveGaDateRange("2026-01-01", "2026-01-31", ANCHOR);

    expect(result).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("handles a daysAgo range that crosses a month boundary", () => {
    const result = resolveGaDateRange("7daysAgo", "today", "2026-08-02 10:00:00");

    expect(result).toEqual({ from: "2026-07-26", to: "2026-08-02" });
  });

  it("returns null for an unrecognized date format", () => {
    expect(resolveGaDateRange("lastMonth", "today", ANCHOR)).toBeNull();
    expect(resolveGaDateRange("30daysAgo", "nextWeek", ANCHOR)).toBeNull();
  });

  it("returns null for an unparsable anchor", () => {
    expect(resolveGaDateRange("30daysAgo", "today", "not-a-date")).toBeNull();
  });
});

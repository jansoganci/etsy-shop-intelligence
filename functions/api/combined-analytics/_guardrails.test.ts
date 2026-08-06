import { describe, expect, it } from "vitest";
import { computeGuardrailStatus, MIN_MATCHED_LISTINGS } from "./_guardrails";

const RANGE = { from: "2026-06-26", to: "2026-07-26" };

describe("computeGuardrailStatus", () => {
  it("returns null rates when there are zero active listings or page rows", () => {
    const result = computeGuardrailStatus({
      totalPageRows: 0,
      matchedPageRows: 0,
      activeListingCount: 0,
      matchedListingCount: 0,
      commonRange: RANGE,
    });

    expect(result.listingMatchRate).toBeNull();
    expect(result.pageMatchRate).toBeNull();
    expect(result.meetsMinimumData).toBe(false);
  });

  it("meets minimum data with a full match", () => {
    const result = computeGuardrailStatus({
      totalPageRows: 20,
      matchedPageRows: 20,
      activeListingCount: 10,
      matchedListingCount: 10,
      commonRange: RANGE,
    });

    expect(result.meetsMinimumData).toBe(true);
    expect(result.listingMatchRate).toBe(1);
    expect(result.pageMatchRate).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it("fails the minimum-data guardrail below the threshold", () => {
    const result = computeGuardrailStatus({
      totalPageRows: 10,
      matchedPageRows: 2,
      activeListingCount: 12,
      matchedListingCount: MIN_MATCHED_LISTINGS - 1,
      commonRange: RANGE,
    });

    expect(result.meetsMinimumData).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("Only 2 listing"))).toBe(true);
  });

  it("adds a reason when the common range is unresolved", () => {
    const result = computeGuardrailStatus({
      totalPageRows: 10,
      matchedPageRows: 5,
      activeListingCount: 5,
      matchedListingCount: 5,
      commonRange: null,
    });

    expect(result.commonRange).toBeNull();
    expect(result.reasons.some((reason) => reason.includes("date range"))).toBe(true);
  });

  it("does not let pageMatchRate affect meetsMinimumData", () => {
    const result = computeGuardrailStatus({
      totalPageRows: 100,
      matchedPageRows: 1,
      activeListingCount: 10,
      matchedListingCount: 5,
      commonRange: RANGE,
    });

    expect(result.pageMatchRate).toBe(0.01);
    expect(result.meetsMinimumData).toBe(true);
  });

  it("always includes the attribution disclaimer", () => {
    const result = computeGuardrailStatus({
      totalPageRows: 0,
      matchedPageRows: 0,
      activeListingCount: 0,
      matchedListingCount: 0,
      commonRange: null,
    });

    expect(result.attributionDisclaimer.length).toBeGreaterThan(10);
  });
});

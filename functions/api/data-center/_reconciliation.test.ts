import { describe, expect, it } from "vitest";
import {
  applyParentMismatchOverride,
  deriveEntityStatus,
  deriveOverallStatus,
  detectCardinalityWarning,
  intersectRange,
  resolveOrphanCount,
  splitCoverage,
} from "./_reconciliation";

describe("intersectRange", () => {
  it("returns the overlap of two overlapping ranges", () => {
    expect(
      intersectRange(
        { min: "2026-01-01", max: "2026-06-30" },
        { min: "2026-04-01", max: "2026-12-31" },
      ),
    ).toEqual({ min: "2026-04-01", max: "2026-06-30" });
  });

  it("returns null/null when ranges do not overlap", () => {
    expect(
      intersectRange(
        { min: "2025-01-01", max: "2025-06-30" },
        { min: "2026-01-01", max: "2026-06-30" },
      ),
    ).toEqual({ min: null, max: null });
  });

  it("returns null/null when either side has no range", () => {
    expect(
      intersectRange({ min: null, max: null }, { min: "2026-01-01", max: "2026-06-30" }),
    ).toEqual({ min: null, max: null });
  });
});

describe("splitCoverage", () => {
  it("splits an only-count into in-range and out-of-range parts", () => {
    expect(splitCoverage(10, 3)).toEqual({ inRange: 7, outOfRange: 3 });
  });

  it("never lets out-of-range exceed the only-count", () => {
    expect(splitCoverage(2, 99)).toEqual({ inRange: 0, outOfRange: 2 });
  });

  it("clamps a negative out-of-range input to zero", () => {
    expect(splitCoverage(5, -1)).toEqual({ inRange: 5, outOfRange: 0 });
  });
});

describe("detectCardinalityWarning", () => {
  it("is false when both sides of the join agree", () => {
    expect(detectCardinalityWarning(893, 893)).toBe(false);
  });

  it("is true when the join produced asymmetric matched counts", () => {
    expect(detectCardinalityWarning(893, 900)).toBe(true);
  });
});

describe("resolveOrphanCount", () => {
  it("returns the real count when the dependent resources are ready", () => {
    expect(resolveOrphanCount(true, 3)).toBe(3);
  });

  it("returns null instead of a possibly-misleading count when not ready", () => {
    expect(resolveOrphanCount(false, 0)).toBeNull();
    expect(resolveOrphanCount(false, 5)).toBeNull();
  });
});

const baseRange = { min: "2026-01-01", max: "2026-06-30" };

describe("deriveEntityStatus", () => {
  it("1. matches when API and CSV fully agree", () => {
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: true,
      apiCount: 893,
      csvCount: 893,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0,
      commonRange: baseRange,
    });
    expect(result.status).toBe("MATCHED");
    expect(result.reason).toBeUndefined();
  });

  it("2. mismatches when either side has only-records inside the shared window", () => {
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: true,
      apiCount: 890,
      csvCount: 893,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 3,
      commonRange: baseRange,
    });
    expect(result.status).toBe("MISMATCH");
  });

  it("3. sync not completed on the API side => NOT_ENOUGH_DATA, not a mismatch", () => {
    const result = deriveEntityStatus({
      apiReady: false,
      csvReady: true,
      apiCount: 0,
      csvCount: 893,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0,
      commonRange: { min: null, max: null },
    });
    expect(result.status).toBe("NOT_ENOUGH_DATA");
    expect(result.reason).toContain("API sync");
  });

  it("4. CSV never imported => NOT_ENOUGH_DATA", () => {
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: false,
      apiCount: 893,
      csvCount: 0,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0,
      commonRange: { min: null, max: null },
    });
    expect(result.status).toBe("NOT_ENOUGH_DATA");
    expect(result.reason).toContain("CSV import");
  });

  it("5. neither source ready => NOT_ENOUGH_DATA with a combined reason", () => {
    const result = deriveEntityStatus({
      apiReady: false,
      csvReady: false,
      apiCount: 0,
      csvCount: 0,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0,
      commonRange: { min: null, max: null },
    });
    expect(result.status).toBe("NOT_ENOUGH_DATA");
    expect(result.reason).toContain("Neither");
  });

  it("6. both ready but a completed period genuinely has zero API records => MATCHED, not NOT_ENOUGH_DATA", () => {
    // Regression guard for the explicit product adjustment: apiCount === 0
    // must not automatically trigger NOT_ENOUGH_DATA when sync completed and
    // CSV also legitimately has zero records for the same source.
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: true,
      apiCount: 0,
      csvCount: 0,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0,
      commonRange: { min: null, max: null },
    });
    expect(result.status).toBe("MATCHED");
  });

  it("7. both ready, API completed with zero rows while CSV has real history => surfaced as MISMATCH, not hidden", () => {
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: true,
      apiCount: 0,
      csvCount: 893,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 893,
      commonRange: { min: null, max: null },
    });
    expect(result.status).toBe("MISMATCH");
  });

  it("8. both sides have data but their date ranges never overlap => NOT_ENOUGH_DATA (shared coverage gate)", () => {
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: true,
      apiCount: 40,
      csvCount: 900,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0,
      commonRange: { min: null, max: null },
    });
    expect(result.status).toBe("NOT_ENOUGH_DATA");
    expect(result.reason).toContain("non-overlapping");
  });

  it("9. only-records outside the shared coverage window do not force a mismatch", () => {
    // e.g. API sync only backfilled the last 2 months; CSV covers 2 years.
    // The CSV-only records from outside the shared window must not count
    // toward apiOnlyInRangeCount/csvOnlyInRangeCount.
    const result = deriveEntityStatus({
      apiReady: true,
      csvReady: true,
      apiCount: 40,
      csvCount: 900,
      apiOnlyInRangeCount: 0,
      csvOnlyInRangeCount: 0, // all csv-only records fell outside commonRange
      commonRange: baseRange,
    });
    expect(result.status).toBe("MATCHED");
  });
});

describe("deriveOverallStatus", () => {
  it("is MISMATCH if any core entity mismatches", () => {
    expect(deriveOverallStatus(["MATCHED", "MISMATCH", "MATCHED"])).toBe("MISMATCH");
  });

  it("is NOT_ENOUGH_DATA if no mismatch but something is unresolved", () => {
    expect(deriveOverallStatus(["MATCHED", "NOT_ENOUGH_DATA", "MATCHED"])).toBe("NOT_ENOUGH_DATA");
  });

  it("is MATCHED only when all core entities matched", () => {
    expect(deriveOverallStatus(["MATCHED", "MATCHED", "MATCHED"])).toBe("MATCHED");
  });

  it("mismatch wins over not-enough-data", () => {
    expect(deriveOverallStatus(["MISMATCH", "NOT_ENOUGH_DATA"])).toBe("MISMATCH");
  });
});

// -----------------------------------------------------------------------
// Phase 5: parent integrity (plan §5.2 -- exact child ID match, wrong parent).
// -----------------------------------------------------------------------

describe("applyParentMismatchOverride", () => {
  it("1. a healthy MATCHED result is downgraded to MISMATCH when parent-mismatched records exist", () => {
    const result = applyParentMismatchOverride({ status: "MATCHED" }, 3);
    expect(result.status).toBe("MISMATCH");
    expect(result.reason).toContain("3");
  });

  it("a zero parent-mismatch count leaves a MATCHED result untouched", () => {
    const result = applyParentMismatchOverride({ status: "MATCHED" }, 0);
    expect(result).toEqual({ status: "MATCHED" });
  });

  it("a null/undefined parent-mismatch count (not yet computed / not ready) leaves the result untouched", () => {
    expect(applyParentMismatchOverride({ status: "MATCHED" }, null)).toEqual({ status: "MATCHED" });
    expect(applyParentMismatchOverride({ status: "MATCHED" }, undefined)).toEqual({ status: "MATCHED" });
  });

  it("an already-MISMATCH result is not touched or double-annotated by the parent-mismatch override", () => {
    const original = { status: "MISMATCH" as const, reason: "existing reason" };
    expect(applyParentMismatchOverride(original, 5)).toBe(original);
  });

  it("NOT_ENOUGH_DATA is never overridden by a parent-mismatch count -- readiness gates take priority", () => {
    const original = { status: "NOT_ENOUGH_DATA" as const, reason: "sync incomplete" };
    expect(applyParentMismatchOverride(original, 2)).toBe(original);
  });
});

import { describe, expect, it } from "vitest";
import { evaluateCutoverReadiness } from "./_cutoverValidation";

describe("evaluateCutoverReadiness", () => {
  it("blocks cutover during an active sync even with force", () => {
    const result = evaluateCutoverReadiness("MATCHED", "MATCHED", true, true);
    expect(result.allowed).toBe(false);
    expect(result.blockingReasons.join(" ")).toContain("currently updating");
  });

  it("allows cutover when both entity and financial reconciliation are MATCHED", () => {
    const result = evaluateCutoverReadiness("MATCHED", "MATCHED", false);
    expect(result.allowed).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
  });

  it("allows cutover with a warning when financial reconciliation is WARNING (within tolerance)", () => {
    const result = evaluateCutoverReadiness("MATCHED", "WARNING", false);
    expect(result.allowed).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("blocks cutover when entity-level reconciliation is MISMATCH", () => {
    const result = evaluateCutoverReadiness("MISMATCH", "MATCHED", false);
    expect(result.allowed).toBe(false);
    expect(result.blockingReasons.length).toBeGreaterThan(0);
  });

  it("blocks cutover when financial reconciliation is MISMATCH", () => {
    const result = evaluateCutoverReadiness("MATCHED", "MISMATCH", false);
    expect(result.allowed).toBe(false);
  });

  it("blocks cutover when either side is NOT_ENOUGH_DATA (never seen a real comparison)", () => {
    expect(evaluateCutoverReadiness("NOT_ENOUGH_DATA", "MATCHED", false).allowed).toBe(false);
    expect(evaluateCutoverReadiness("MATCHED", "NOT_ENOUGH_DATA", false).allowed).toBe(false);
  });

  it("collects every applicable blocking reason, not just the first", () => {
    const result = evaluateCutoverReadiness("MISMATCH", "MISMATCH", false);
    expect(result.blockingReasons).toHaveLength(2);
  });

  it("does not enable automatically: the default (force=false) path requires all checks to pass", () => {
    const result = evaluateCutoverReadiness("NOT_ENOUGH_DATA", "NOT_ENOUGH_DATA", false);
    expect(result.allowed).toBe(false);
  });

  it("force=true cannot bypass blocking reasons", () => {
    const result = evaluateCutoverReadiness("MISMATCH", "MISMATCH", true);
    expect(result.allowed).toBe(false);
    expect(result.blockingReasons.length).toBeGreaterThan(0);
  });

  it("blocks payments cutover until the payments sync resource has completed", () => {
    const result = evaluateCutoverReadiness("MATCHED", "MATCHED", false, false, {
      paymentsResourceCompleted: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockingReasons.join(" ")).toContain("Payments sync resource");
  });
});

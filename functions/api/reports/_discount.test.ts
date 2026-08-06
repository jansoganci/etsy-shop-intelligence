import { describe, expect, it } from "vitest";
import { aggregateDiscountRate, discountRate } from "./_discount";

describe("discountRate", () => {
  it("returns 25% for 5/20, not the inflated 5/15 subtotal base", () => {
    expect(discountRate(5, 20, "USD", "USD")).toBe(0.25);
    expect(discountRate(5, 15, "USD", "USD")).toBeCloseTo(0.333333, 5);
  });

  it("returns null on currency mismatch", () => {
    expect(discountRate(5, 20, "USD", "TRY")).toBeNull();
  });

  it("returns null on zero or missing denominator", () => {
    expect(discountRate(5, 0, "USD", "USD")).toBeNull();
    expect(discountRate(5, null, "USD", "USD")).toBeNull();
    expect(discountRate(null, 20, "USD", "USD")).toBeNull();
  });

  it("ignores currency casing when both sides match", () => {
    expect(discountRate(5, 20, "usd", "USD")).toBe(0.25);
  });
});

describe("aggregateDiscountRate", () => {
  it("sums discount and total_price before dividing", () => {
    expect(aggregateDiscountRate(10, 80)).toBe(0.125);
  });

  it("returns null when total price sum is zero", () => {
    expect(aggregateDiscountRate(5, 0)).toBeNull();
  });
});

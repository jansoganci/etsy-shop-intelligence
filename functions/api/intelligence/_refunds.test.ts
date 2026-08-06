import { describe, expect, it } from "vitest";
import { sumSuccessfulAdjustments, type AdjustmentInput } from "./_refunds";

function adjustment(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return {
    isSuccess: true,
    totalAdjustmentAmountCents: 500,
    ...overrides,
  };
}

describe("sumSuccessfulAdjustments", () => {
  it("no refund: an empty adjustment list is a confirmed zero, not unavailable", () => {
    const result = sumSuccessfulAdjustments([]);
    expect(result.refundAmount).toBe(0);
    expect(result.successfulAdjustmentCount).toBe(0);
  });

  it("no refund: adjustments exist but none succeeded is also a confirmed zero", () => {
    const result = sumSuccessfulAdjustments([
      adjustment({ isSuccess: false, totalAdjustmentAmountCents: 2148 }),
    ]);
    expect(result.refundAmount).toBe(0);
    expect(result.successfulAdjustmentCount).toBe(0);
  });

  it("full refund: a single successful adjustment equal to the full payment", () => {
    // $21.48 payment, fully refunded.
    const result = sumSuccessfulAdjustments([adjustment({ totalAdjustmentAmountCents: 2148 })]);
    expect(result.refundAmount).toBeCloseTo(21.48, 8);
    expect(result.successfulAdjustmentCount).toBe(1);
  });

  it("partial refund: a single successful adjustment less than the full payment", () => {
    // $21.48 payment, $5.00 refunded.
    const result = sumSuccessfulAdjustments([adjustment({ totalAdjustmentAmountCents: 500 })]);
    expect(result.refundAmount).toBeCloseTo(5.0, 8);
    expect(result.successfulAdjustmentCount).toBe(1);
  });

  it("multiple refunds: several successful adjustments on the same payment are summed", () => {
    const result = sumSuccessfulAdjustments([
      adjustment({ totalAdjustmentAmountCents: 300 }),
      adjustment({ totalAdjustmentAmountCents: 200 }),
      adjustment({ totalAdjustmentAmountCents: 150 }),
    ]);
    expect(result.refundAmount).toBeCloseTo(6.5, 8);
    expect(result.successfulAdjustmentCount).toBe(3);
  });

  it("multiple adjustments: failed and pending adjustments are excluded from the sum", () => {
    const result = sumSuccessfulAdjustments([
      adjustment({ isSuccess: true, totalAdjustmentAmountCents: 500 }),
      adjustment({ isSuccess: false, totalAdjustmentAmountCents: 2148 }),
      adjustment({ isSuccess: true, totalAdjustmentAmountCents: 300 }),
    ]);
    expect(result.refundAmount).toBeCloseTo(8.0, 8);
    expect(result.successfulAdjustmentCount).toBe(2);
  });

  it("does not invent a value when a successful adjustment has no amount", () => {
    const result = sumSuccessfulAdjustments([
      adjustment({ totalAdjustmentAmountCents: 300 }),
      adjustment({ totalAdjustmentAmountCents: null }),
    ]);
    expect(result.refundAmount).toBeNull();
    expect(result.successfulAdjustmentCount).toBe(2);
  });

  it("mixed adjustment + refund: only payment_adjustments feed this total, never a receipt-level refund", () => {
    // Conceptually the same real-world refund can appear both as a
    // PaymentAdjustment (payment-grain, $5) and a ShopRefund on the receipt
    // (receipt-grain, also $5, stored separately in etsy_api_receipt_refunds).
    // This function only ever sees payment_adjustments input, so it cannot
    // double-count the receipt-level view of the same event -- the receipt
    // refund is captured elsewhere (etsy_api_receipt_refunds) but never
    // added in here.
    const result = sumSuccessfulAdjustments([adjustment({ totalAdjustmentAmountCents: 500 })]);
    expect(result.refundAmount).toBeCloseTo(5.0, 8);
    expect(result.successfulAdjustmentCount).toBe(1);
  });
});

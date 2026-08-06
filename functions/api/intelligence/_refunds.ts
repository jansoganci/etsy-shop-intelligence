export type AdjustmentInput = {
  isSuccess: boolean;
  totalAdjustmentAmountCents: number | null;
};

export type RefundAmountResult = {
  /** Major currency units (e.g. dollars, not cents), or null when unavailable. */
  refundAmount: number | null;
  successfulAdjustmentCount: number;
};

/**
 * Mirrors the `refund_amount` derivation in `v_payments_canonical`
 * (migrations 0012/0013): sums *successful* Etsy payment adjustments only,
 * converting from minor units (Etsy's PaymentAdjustment amounts are
 * documented as USD-pennies-style integers, no explicit divisor field).
 *
 * - Zero successful adjustments is a confirmed "no refund" (0), not a
 *   missing value -- we did fetch the adjustments, there just weren't any.
 * - A successful adjustment with no amount makes the whole total
 *   unavailable (null) rather than silently summing only the rows that
 *   happen to have one, which would understate the true refund.
 * - Failed/pending adjustments are excluded entirely, so partial refunds,
 *   multiple adjustments, and full refunds all fall out of a plain sum.
 */
export function sumSuccessfulAdjustments(adjustments: AdjustmentInput[]): RefundAmountResult {
  const successful = adjustments.filter((adjustment) => adjustment.isSuccess);

  if (successful.length === 0) {
    return { refundAmount: 0, successfulAdjustmentCount: 0 };
  }

  const hasMissingAmount = successful.some(
    (adjustment) => adjustment.totalAdjustmentAmountCents === null,
  );

  if (hasMissingAmount) {
    return { refundAmount: null, successfulAdjustmentCount: successful.length };
  }

  const totalCents = successful.reduce(
    (sum, adjustment) => sum + (adjustment.totalAdjustmentAmountCents ?? 0),
    0,
  );

  return { refundAmount: totalCents / 100, successfulAdjustmentCount: successful.length };
}

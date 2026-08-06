/** discount_amt / total_price. subtotal is ALREADY net of the discount. */
export function discountRate(
  discountAmount: number | null,
  totalPrice: number | null,
  discountCurrency: string | null,
  totalPriceCurrency: string | null,
): number | null {
  if (discountAmount == null || totalPrice == null || totalPrice <= 0) {
    return null;
  }

  if (
    discountCurrency
    && totalPriceCurrency
    && discountCurrency.trim().toUpperCase() !== totalPriceCurrency.trim().toUpperCase()
  ) {
    return null;
  }

  return discountAmount / totalPrice;
}

/** v_orders_canonical.order_value stores Etsy total_price (pre-discount list total). */
export function aggregateDiscountRate(
  discountTotal: number | null,
  totalPriceTotal: number | null,
): number | null {
  if (discountTotal == null || totalPriceTotal == null || totalPriceTotal <= 0) {
    return null;
  }

  return discountTotal / totalPriceTotal;
}

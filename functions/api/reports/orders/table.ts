import { handleTableRequest, type TableRequestContext } from "../_table";

// Canonical Net Revenue source is payments.net_amount (see
// functions/api/intelligence/_financials.ts), not the orders-table payout
// fields. Single-payment-row orders only: p.average_exchange_rate equals
// that one row's own exchange_rate there (not an averaged rate); orders with
// more than one payment row, or a missing payment row, are left NULL rather
// than guessing. Never falls back to 0 via COALESCE — a missing amount is
// unknown, not a real zero.
const NET_USD_REVENUE_SQL = `
  CASE
    WHEN p.payment_row_count = 1 AND p.payment_currency = 'USD'
      THEN p.net_amount
    WHEN p.payment_row_count = 1 AND p.payment_currency = 'TRY'
      AND p.listing_currency = 'USD' AND p.average_exchange_rate > 0
      THEN p.net_amount / p.average_exchange_rate
    ELSE NULL
  END
`;

// Gross Sales (USD) only when the order is USD-denominated and order_value is
// present. Non-USD, missing currency, or missing amount → NULL (never 0 via
// COALESCE on order_value).
const REVENUE_AFTER_DISCOUNT_SQL = `
  CASE
    WHEN UPPER(TRIM(COALESCE(o.order_currency, ''))) = 'USD'
      AND o.order_value IS NOT NULL
      THEN o.order_value - COALESCE(o.discount_amount, 0)
    ELSE NULL
  END
`;

const PROFIT_MARGIN_SQL = `
  (${NET_USD_REVENUE_SQL}) / NULLIF(${REVENUE_AFTER_DISCOUNT_SQL}, 0)
`;

export async function onRequestGet(context: TableRequestContext): Promise<Response> {
  return handleTableRequest(context, {
    fromSql: `
      v_orders_canonical AS o
      LEFT JOIN v_payments_by_order_canonical AS p
        ON o.order_id = p.order_id
    `,
    defaultSortBy: "saleDate",
    defaultSortDir: "desc",
    sortableColumns: {
      orderId: "o.order_id",
      saleDate: "o.sale_date",
      country: "o.ship_country",
      city: "o.ship_city",
      orderTotal: "o.order_total",
      orderStatus: "o.order_status",
      orderCurrency: "o.order_currency",
      couponCode: "o.coupon_code",
      revenueAfterDiscount: REVENUE_AFTER_DISCOUNT_SQL,
      netUsdRevenue: NET_USD_REVENUE_SQL,
      profitMargin: PROFIT_MARGIN_SQL,
    },
    selectColumns: [
      "o.order_id AS orderId",
      "o.sale_date AS saleDate",
      "o.sale_date_raw AS saleDateRaw",
      "o.number_of_items AS numberOfItems",
      "o.ship_country AS shipCountry",
      "o.ship_city AS shipCity",
      "o.order_currency AS orderCurrency",
      "o.order_value AS orderValue",
      "o.coupon_code AS couponCode",
      "o.coupon_details AS couponDetails",
      "o.discount_amount AS discountAmount",
      "o.shipping_discount AS shippingDiscount",
      "o.shipping AS shipping",
      "o.sales_tax AS salesTax",
      "o.order_total AS orderTotal",
      "o.order_status AS orderStatus",
      "o.payout_card_processing_fees AS payoutCardProcessingFees",
      "o.payout_order_net AS payoutOrderNet",
      "o.adjusted_order_total AS adjustedOrderTotal",
      "o.payout_adjusted_card_processing_fees AS payoutAdjustedCardProcessingFees",
      "o.payout_adjusted_net_order_amount AS payoutAdjustedNetOrderAmount",
      "o.order_type AS orderType",
      "o.payment_type AS paymentType",
      "o.sku AS sku",
      "p.average_exchange_rate AS averageExchangeRate",
      `${REVENUE_AFTER_DISCOUNT_SQL} AS revenueAfterDiscount`,
      `(${NET_USD_REVENUE_SQL}) AS netUsdRevenue`,
      `(${PROFIT_MARGIN_SQL}) AS profitMargin`,
    ],
    filterColumns: {
      date: "o.sale_date",
      country: "o.ship_country",
      city: "o.ship_city",
      couponCode: "o.coupon_code",
      currency: "o.order_currency",
      orderId: "o.order_id",
      status: "o.order_status",
      q: ["o.order_id", "o.coupon_code", "o.coupon_details", "o.ship_country", "o.ship_city", "o.sku"],
    },
  });
}

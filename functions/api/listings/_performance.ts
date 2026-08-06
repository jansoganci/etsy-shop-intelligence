import { assessCurrency } from "../intelligence/_financials";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type ListingPerformance = {
  listingId: string;
  totalOrders: number;
  totalUnits: number;
  totalGrossSalesUsd: number | null;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  currencyValid: boolean;
};

type PerformanceRow = {
  orderCount: number | null;
  unitsSold: number | null;
  grossSalesUsd: number | null;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
};

function toNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function currencyValues(value: string | null | undefined): string[] {
  return value?.split(",").map((currency) => currency.trim()).filter(Boolean) ?? [];
}

export async function getListingPerformance(
  db: D1Database,
  listingId: string,
): Promise<ListingPerformance> {
  const row = await db
    .prepare(
      `
        SELECT
          COUNT(DISTINCT order_id) AS orderCount,
          SUM(quantity) AS unitsSold,
          SUM(item_total - COALESCE(discount_amount, 0)) AS grossSalesUsd,
          MIN(sale_date) AS firstOrderDate,
          MAX(sale_date) AS lastOrderDate,
          GROUP_CONCAT(DISTINCT item_currency) AS currencies,
          SUM(CASE WHEN item_currency IS NULL OR TRIM(item_currency) = '' THEN 1 ELSE 0 END)
            AS missingCurrencyRows
        FROM v_order_items_canonical
        WHERE listing_id = ? AND sale_date IS NOT NULL
      `,
    )
    .bind(listingId)
    .first<PerformanceRow>();

  const totalOrders = toNumber(row?.orderCount);

  // A listing with zero historical order items has no currency to be wrong
  // about -- that's a real $0, not "insufficient currency information".
  // Once there is at least one order item, Gross Sales is only labeled USD
  // when every row agrees: no missing currency, exactly one distinct
  // currency, and that currency is USD (same rule as _financials.ts's
  // assessCurrency -- mixed, missing, or non-USD must not be silently
  // reported as a USD figure).
  const currencyValid =
    totalOrders === 0
    || assessCurrency(
      currencyValues(row?.currencies),
      toNumber(row?.missingCurrencyRows),
      "USD",
    ).valid;

  return {
    listingId,
    totalOrders,
    totalUnits: toNumber(row?.unitsSold),
    totalGrossSalesUsd: currencyValid ? toNumber(row?.grossSalesUsd) : null,
    firstOrderDate: row?.firstOrderDate ?? null,
    lastOrderDate: row?.lastOrderDate ?? null,
    currencyValid,
  };
}

import type { DateRange, EntityReconciliation } from "./_reconciliation";

// ---------------------------------------------------------------------------
// This module reads only raw, stable source columns from tables owned by this
// feature's own code (etsy_api_receipts / etsy_api_payments / v_orders_clean /
// v_payments_clean) and depends only on this feature's own Phase 1 module
// (_reconciliation.ts). It never imports from, edits, or stages the parallel
// financial workstream's files.
//
// Phase 3 (currency/exchange-rate reconciliation) is a documented exception to
// "no dependency on that workstream": comparing currencies is impossible
// without a payment's currency fields, which only exist because of that
// workstream's migrations. Per an explicit product decision, this module
// treats migration 0012 (etsy_api_payments.currency/shop_currency/
// buyer_currency) and 0013 (payment adjustments/refunds) as a READ-ONLY,
// already-applied schema dependency: their columns are selected here, but
// their files are never modified. If those migrations are renamed or
// reworked before merge, the Phase 3 queries below will need updating.
// ---------------------------------------------------------------------------

export type MetricStatus = "MATCHED" | "WARNING" | "MISMATCH" | "NOT_ENOUGH_DATA";

/** A flat, fixed tolerance for Phase 2/3. Not scaled by matched-record count or
 * expressed as versioned rules configuration yet — see reconciliation plan §6.7
 * for the fuller model; this is an intentional starting simplification. */
const TOLERANCE_USD = 0.02;

/** Phase 3 only supports converting into this single reporting currency,
 * matching the existing app-wide USD assumption (see _financials.ts's own
 * `expectedCurrency = "USD"` default). Multi-reporting-currency configuration
 * is out of scope. */
const REPORTING_CURRENCY = "USD";

export type ConversionMethod = "identity" | "csv_row_rate" | "mixed" | "unavailable";

export type FinancialMetric = {
  key: string;
  label: string;
  businessBasis: string;
  apiValue: number | null;
  csvValue: number | null;
  currency: string | null;
  difference: number | null;
  differencePercentage: number | null;
  status: MetricStatus;
  reason?: string;
  conversion?: {
    apiMethod: ConversionMethod;
    csvMethod: ConversionMethod;
    apiUnconvertibleCount: number;
    csvUnconvertibleCount: number;
  };
};

export type MonthlyFinancialEntry = {
  month: string;
  orderCount: { api: number; csv: number } | null;
  paymentCount: { api: number; csv: number } | null;
  metrics: FinancialMetric[];
  status: MetricStatus;
};

export type MonthlyFinancialsResult = {
  months: MonthlyFinancialEntry[];
  status: MetricStatus;
  ordersAvailable: boolean;
  paymentsAvailable: boolean;
};

// Metrics that are structurally unavailable (no CSV counterpart at all) never
// drive month/overall status. "refund" graduated out of this set once
// migration 0013 normalized payment adjustments -- a month can now
// genuinely have a comparable (or genuinely unavailable) refund total, so it
// participates like any other real metric.
const STUB_METRIC_KEYS = new Set(["vat"]);

// ---------------------------------------------------------------------------
// Pure logic (unit tested independently of D1).
// ---------------------------------------------------------------------------

export function deriveMetricStatus(
  apiValue: number | null,
  csvValue: number | null,
  apiCurrency: string | null,
  csvCurrency: string | null,
  tolerance: number = TOLERANCE_USD,
): { status: MetricStatus; difference: number | null; differencePercentage: number | null; reason?: string } {
  if (apiValue === null || csvValue === null) {
    return {
      status: "NOT_ENOUGH_DATA",
      difference: null,
      differencePercentage: null,
      reason: "One side has no value for this metric in this month.",
    };
  }

  const normalizedApiCurrency = apiCurrency?.trim().toUpperCase() || null;
  const normalizedCsvCurrency = csvCurrency?.trim().toUpperCase() || null;
  if (!normalizedApiCurrency || !normalizedCsvCurrency || normalizedApiCurrency !== normalizedCsvCurrency) {
    return {
      status: "NOT_ENOUGH_DATA",
      difference: null,
      differencePercentage: null,
      reason: "Currency is missing or differs between API and CSV for this metric; cross-currency comparison is a later phase.",
    };
  }

  const difference = apiValue - csvValue;
  const differencePercentage = csvValue !== 0 ? (difference / csvValue) * 100 : null;

  if (difference === 0) {
    return { status: "MATCHED", difference, differencePercentage };
  }
  if (Math.abs(difference) <= tolerance) {
    return {
      status: "WARNING",
      difference,
      differencePercentage,
      reason: `Within the ${tolerance} tolerance (rounding).`,
    };
  }
  return { status: "MISMATCH", difference, differencePercentage };
}

export function deriveMonthStatus(metrics: FinancialMetric[]): MetricStatus {
  const coreStatuses = metrics.filter((metric) => !STUB_METRIC_KEYS.has(metric.key)).map((metric) => metric.status);
  if (coreStatuses.includes("MISMATCH")) return "MISMATCH";
  if (coreStatuses.includes("NOT_ENOUGH_DATA")) return "NOT_ENOUGH_DATA";
  if (coreStatuses.includes("WARNING")) return "WARNING";
  return coreStatuses.length > 0 ? "MATCHED" : "NOT_ENOUGH_DATA";
}

export function deriveOverallMonthlyStatus(monthStatuses: MetricStatus[]): MetricStatus {
  if (monthStatuses.includes("MISMATCH")) return "MISMATCH";
  if (monthStatuses.includes("NOT_ENOUGH_DATA")) return "NOT_ENOUGH_DATA";
  if (monthStatuses.includes("WARNING")) return "WARNING";
  return monthStatuses.length > 0 ? "MATCHED" : "NOT_ENOUGH_DATA";
}

// ---------------------------------------------------------------------------
// Phase 3: currency conversion. Only two conversion paths are ever accepted —
// same-currency identity, and the CSV export's own per-row exchange_rate for
// TRY->USD. No rate is ever invented for API cross-currency amounts (the Etsy
// Payment endpoint provides no exchange_rate field), matching plan §7.2.
// ---------------------------------------------------------------------------

export type ConversionReasonCode = "EXCHANGE_RATE_MISSING" | "UNSUPPORTED_CURRENCY_PAIR";

export function resolveConversion(
  currency: string | null,
  listingCurrency: string | null,
  exchangeRate: number | null,
): { method: "identity" | "csv_row_rate" | "unavailable"; rate: number | null; reasonCode?: ConversionReasonCode } {
  const normalized = currency?.trim().toUpperCase() || null;
  if (normalized === REPORTING_CURRENCY) {
    return { method: "identity", rate: 1 };
  }
  if (!normalized) {
    return { method: "unavailable", rate: null, reasonCode: "EXCHANGE_RATE_MISSING" };
  }
  if (normalized === "TRY" && (listingCurrency?.trim().toUpperCase() || null) === REPORTING_CURRENCY) {
    if (typeof exchangeRate === "number" && Number.isFinite(exchangeRate) && exchangeRate > 0) {
      return { method: "csv_row_rate", rate: exchangeRate };
    }
    return { method: "unavailable", rate: null, reasonCode: "EXCHANGE_RATE_MISSING" };
  }
  return { method: "unavailable", rate: null, reasonCode: "UNSUPPORTED_CURRENCY_PAIR" };
}

export function convertToReportingCurrency(
  amount: number | null,
  currency: string | null,
  listingCurrency: string | null,
  exchangeRate: number | null,
): { valueUsd: number | null; method: "identity" | "csv_row_rate" | "unavailable"; reasonCode?: ConversionReasonCode } {
  if (amount === null || !Number.isFinite(amount)) {
    return { valueUsd: null, method: "unavailable", reasonCode: "EXCHANGE_RATE_MISSING" };
  }
  const { method, rate, reasonCode } = resolveConversion(currency, listingCurrency, exchangeRate);
  if (method === "unavailable" || rate === null) {
    return { valueUsd: null, method, reasonCode };
  }
  return { valueUsd: amount / rate, method };
}

/** Rolls up per-row conversion outcomes for a whole month into one label. */
export function summarizeConversionMethod(
  identityCount: number,
  csvRateCount: number,
  unconvertibleCount: number,
): ConversionMethod {
  const total = identityCount + csvRateCount + unconvertibleCount;
  if (total === 0 || unconvertibleCount === total) return "unavailable";
  if (unconvertibleCount > 0) return "mixed";
  if (csvRateCount > 0 && identityCount > 0) return "mixed";
  return csvRateCount > 0 ? "csv_row_rate" : "identity";
}

function buildMetric(
  key: string,
  label: string,
  businessBasis: string,
  apiValue: number | null,
  csvValue: number | null,
  apiCurrency: string | null,
  csvCurrency: string | null,
): FinancialMetric {
  const { status, difference, differencePercentage, reason } = deriveMetricStatus(
    apiValue,
    csvValue,
    apiCurrency,
    csvCurrency,
  );
  const currency = status === "NOT_ENOUGH_DATA" ? null : apiCurrency?.trim().toUpperCase() ?? null;
  return {
    key,
    label,
    businessBasis,
    apiValue,
    csvValue,
    currency,
    difference,
    differencePercentage,
    status,
    ...(reason ? { reason } : {}),
  };
}

function buildStubMetric(key: string, label: string, businessBasis: string, apiValue: number | null, reason: string): FinancialMetric {
  return {
    key,
    label,
    businessBasis,
    apiValue,
    csvValue: null,
    currency: null,
    difference: null,
    differencePercentage: null,
    status: "NOT_ENOUGH_DATA",
    reason,
  };
}

type ConversionCounts = { identity: number; csvRate: number; unconvertible: number };

/**
 * Payment metrics only ever see values that a SQL query has already converted
 * to REPORTING_CURRENCY (see loadPaymentMonths/loadRefundMonths) -- a null
 * value here means that side had nothing convertible, not that the raw
 * amount was missing. This always compares two same-currency (USD) values,
 * so the existing deriveMetricStatus currency-equality check is satisfied
 * trivially; what this adds is the conversion method/unconvertible-count
 * transparency the plan's Faz3 acceptance criteria require ("her converted
 * metric rate source'u gösterir").
 */
export function buildConvertedMetric(
  key: string,
  label: string,
  businessBasis: string,
  apiValue: number | null,
  csvValue: number | null,
  apiConversion: ConversionCounts,
  csvConversion: ConversionCounts,
): FinancialMetric {
  const apiMethod = summarizeConversionMethod(apiConversion.identity, apiConversion.csvRate, apiConversion.unconvertible);
  const csvMethod = summarizeConversionMethod(csvConversion.identity, csvConversion.csvRate, csvConversion.unconvertible);
  const apiCurrency = apiValue !== null ? REPORTING_CURRENCY : null;
  const csvCurrency = csvValue !== null ? REPORTING_CURRENCY : null;
  const base = buildMetric(key, label, businessBasis, apiValue, csvValue, apiCurrency, csvCurrency);
  const hasExcludedRows = apiConversion.unconvertible > 0 || csvConversion.unconvertible > 0;

  const notes: string[] = [];
  if (apiConversion.unconvertible > 0) {
    notes.push(
      `${apiConversion.unconvertible} API row(s) could not be converted to ${REPORTING_CURRENCY} and are excluded from this total.`,
    );
  }
  if (csvConversion.unconvertible > 0) {
    notes.push(
      `${csvConversion.unconvertible} CSV row(s) could not be converted to ${REPORTING_CURRENCY} and are excluded from this total.`,
    );
  }
  const reason = notes.length > 0 ? [base.reason, ...notes].filter(Boolean).join(" ") : base.reason;

  return {
    ...base,
    ...(hasExcludedRows
      ? {
          status: "NOT_ENOUGH_DATA" as const,
          difference: null,
          differencePercentage: null,
          currency: null,
        }
      : {}),
    ...(reason ? { reason } : {}),
    conversion: {
      apiMethod,
      csvMethod,
      apiUnconvertibleCount: apiConversion.unconvertible,
      csvUnconvertibleCount: csvConversion.unconvertible,
    },
  };
}

// ---------------------------------------------------------------------------
// D1-backed monthly aggregation.
// ---------------------------------------------------------------------------

type OrderMonthRow = {
  month: string;
  count: number;
  total_price: number | null;
  discount: number | null;
  shipping: number | null;
  tax: number | null;
  vat: number | null;
  order_total: number | null;
  currency: string | null;
  currency_count: number;
};

type PaymentMonthRow = {
  month: string;
  count: number;
  gross: number | null;
  fees: number | null;
  net: number | null;
  posted_gross: number | null;
  posted_fees: number | null;
  posted_net: number | null;
  adjusted_gross: number | null;
  adjusted_fees: number | null;
  adjusted_net: number | null;
  identity_count: number;
  csv_rate_count: number;
  unconvertible_count: number;
};

type RefundMonthRow = {
  month: string;
  refund: number | null;
  identity_count: number;
  csv_rate_count: number;
  unconvertible_count: number;
};

// D1's `.all()` (not `.first()`) is required for multi-row grouped queries;
// the local minimal D1Database interface in _reconciliation.ts only exposes
// `.first()`. This is a structural superset (adds `.all()`), so it remains
// assignable wherever a plain D1Database is expected.
export interface D1PreparedStatementWithAll {
  bind(...values: unknown[]): D1PreparedStatementWithAll;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface D1DatabaseWithAll {
  prepare(query: string): D1PreparedStatementWithAll;
}

async function loadOrderMonths(
  db: D1DatabaseWithAll,
  table: "api" | "csv",
  range: DateRange,
): Promise<OrderMonthRow[]> {
  const query =
    table === "api"
      ? `
        SELECT
          strftime('%Y-%m', datetime(create_timestamp, 'unixepoch')) AS month,
          COUNT(*) AS count,
          SUM(total_price_amount * 1.0 / NULLIF(total_price_divisor, 0)) AS total_price,
          SUM(discount_amt_amount * 1.0 / NULLIF(discount_amt_divisor, 0)) AS discount,
          SUM(total_shipping_cost_amount * 1.0 / NULLIF(total_shipping_cost_divisor, 0)) AS shipping,
          SUM(total_tax_cost_amount * 1.0 / NULLIF(total_tax_cost_divisor, 0)) AS tax,
          SUM(total_vat_cost_amount * 1.0 / NULLIF(total_vat_cost_divisor, 0)) AS vat,
          SUM(grandtotal_amount * 1.0 / NULLIF(grandtotal_divisor, 0)) AS order_total,
          MIN(total_price_currency) AS currency,
          COUNT(DISTINCT total_price_currency) AS currency_count
        FROM etsy_api_receipts
        WHERE date(create_timestamp, 'unixepoch') BETWEEN ? AND ?
        GROUP BY month
      `
      : `
        SELECT
          substr(sale_date, 1, 7) AS month,
          COUNT(*) AS count,
          SUM(order_value) AS total_price,
          SUM(discount_amount) AS discount,
          SUM(shipping) AS shipping,
          SUM(sales_tax) AS tax,
          NULL AS vat,
          SUM(order_total) AS order_total,
          MIN(order_currency) AS currency,
          COUNT(DISTINCT order_currency) AS currency_count
        FROM v_orders_clean
        WHERE sale_date BETWEEN ? AND ?
        GROUP BY month
      `;
  const result = await db.prepare(query).bind(range.min, range.max).all<OrderMonthRow>();
  return result.results ?? [];
}

async function loadPaymentMonths(
  db: D1DatabaseWithAll,
  table: "api" | "csv",
  range: DateRange,
): Promise<PaymentMonthRow[]> {
  // Every amount column is converted to REPORTING_CURRENCY per row, before
  // aggregation, because the CSV export's exchange_rate is only meaningful
  // per payment row (plan §7.2 rule 2) -- summing native-currency amounts
  // first and converting the aggregate afterwards would be wrong whenever
  // rows have different rates. Rows that cannot be converted (missing rate,
  // unsupported pair) contribute NULL, which SUM() silently excludes; the
  // *_count columns make that exclusion visible instead of hiding it.
  const query =
    table === "api"
      ? `
        SELECT
          month,
          COUNT(*) AS count,
          SUM(gross_usd) AS gross,
          SUM(fees_usd) AS fees,
          SUM(net_usd) AS net,
          SUM(posted_gross_usd) AS posted_gross,
          SUM(posted_fees_usd) AS posted_fees,
          SUM(posted_net_usd) AS posted_net,
          SUM(adjusted_gross_usd) AS adjusted_gross,
          SUM(adjusted_fees_usd) AS adjusted_fees,
          SUM(adjusted_net_usd) AS adjusted_net,
          SUM(is_identity) AS identity_count,
          SUM(is_csv_rate) AS csv_rate_count,
          SUM(CASE WHEN is_identity = 0 AND is_csv_rate = 0 THEN 1 ELSE 0 END) AS unconvertible_count
        FROM (
          SELECT
            substr(order_date, 1, 7) AS month,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN gross_amount
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN gross_amount / exchange_rate
            END AS gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN fees
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN fees / exchange_rate
            END AS fees_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN net_amount
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN net_amount / exchange_rate
            END AS net_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_gross
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN posted_gross / exchange_rate
            END AS posted_gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_fees
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN posted_fees / exchange_rate
            END AS posted_fees_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_net
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN posted_net / exchange_rate
            END AS posted_net_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN adjusted_gross
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN adjusted_gross / exchange_rate
            END AS adjusted_gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN adjusted_fees
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN adjusted_fees / exchange_rate
            END AS adjusted_fees_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN adjusted_net
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
                THEN adjusted_net / exchange_rate
            END AS adjusted_net_usd,
            CASE WHEN UPPER(payment_currency) = 'USD' THEN 1 ELSE 0 END AS is_identity,
            CASE
              WHEN UPPER(payment_currency) = 'TRY'
                AND UPPER(listing_currency) = 'USD'
                AND exchange_rate IS NOT NULL AND exchange_rate > 0
              THEN 1 ELSE 0
            END AS is_csv_rate
          FROM v_payments_canonical
          WHERE data_source IN ('etsy_api', 'etsy_api+csv')
            AND order_date BETWEEN ? AND ?
        ) x
        GROUP BY month
      `
      : `
        SELECT
          month,
          COUNT(*) AS count,
          SUM(gross_usd) AS gross,
          SUM(fees_usd) AS fees,
          SUM(net_usd) AS net,
          SUM(posted_gross_usd) AS posted_gross,
          SUM(posted_fees_usd) AS posted_fees,
          SUM(posted_net_usd) AS posted_net,
          SUM(adjusted_gross_usd) AS adjusted_gross,
          SUM(adjusted_fees_usd) AS adjusted_fees,
          SUM(adjusted_net_usd) AS adjusted_net,
          SUM(is_identity) AS identity_count,
          SUM(is_csv_rate) AS csv_rate_count,
          SUM(CASE WHEN is_identity = 0 AND is_csv_rate = 0 THEN 1 ELSE 0 END) AS unconvertible_count
        FROM (
          SELECT
            substr(order_date, 1, 7) AS month,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN gross_amount
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN gross_amount / exchange_rate
            END AS gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN fees
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN fees / exchange_rate
            END AS fees_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN net_amount
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN net_amount / exchange_rate
            END AS net_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_gross
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN posted_gross / exchange_rate
            END AS posted_gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_fees
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN posted_fees / exchange_rate
            END AS posted_fees_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN posted_net
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN posted_net / exchange_rate
            END AS posted_net_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN adjusted_gross
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN adjusted_gross / exchange_rate
            END AS adjusted_gross_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN adjusted_fees
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN adjusted_fees / exchange_rate
            END AS adjusted_fees_usd,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN adjusted_net
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN adjusted_net / exchange_rate
            END AS adjusted_net_usd,
            CASE WHEN UPPER(payment_currency) = 'USD' THEN 1 ELSE 0 END AS is_identity,
            CASE WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
              THEN 1 ELSE 0 END AS is_csv_rate
          FROM v_payments_clean
          WHERE order_date BETWEEN ? AND ?
        ) x
        GROUP BY month
      `;
  const result = await db.prepare(query).bind(range.min, range.max).all<PaymentMonthRow>();
  return result.results ?? [];
}

async function loadRefundMonths(
  db: D1DatabaseWithAll,
  table: "api" | "csv",
  range: DateRange,
): Promise<RefundMonthRow[]> {
  // API side: months are bucketed off etsy_api_payments (matching
  // loadPaymentMonths), left-joined to adjustments so a month with payment
  // activity but zero successful refunds correctly reads as a confirmed 0,
  // not a missing value. A successful adjustment with no amount makes that
  // month's total NULL rather than silently understating it -- same rule as
  // v_payments_canonical.refund_amount (migration 0013).
  // Etsy's PaymentAdjustment amounts have no currency field at all -- the API
  // schema documents them as always USD pennies (migration 0013), so the API
  // side is trivially "identity" whenever a month has payment rows, no rate
  // lookup involved. The CSV refund_amount shares its row's payment_currency/
  // exchange_rate, so it goes through the same conversion as the other
  // payment metrics.
  const query =
    table === "api"
      ? `
        SELECT
          strftime('%Y-%m', datetime(p.create_timestamp, 'unixepoch')) AS month,
          CASE
            WHEN SUM(CASE WHEN pa.is_success = 1 AND pa.total_adjustment_amount IS NULL THEN 1 ELSE 0 END) > 0
              THEN NULL
            ELSE SUM(CASE WHEN pa.is_success = 1 THEN pa.total_adjustment_amount * 1.0 / 100 ELSE 0 END)
          END AS refund,
          COUNT(*) AS identity_count,
          0 AS csv_rate_count,
          0 AS unconvertible_count
        FROM etsy_api_payments p
        LEFT JOIN etsy_api_payment_adjustments pa ON pa.payment_id = p.payment_id
        WHERE date(p.create_timestamp, 'unixepoch') BETWEEN ? AND ?
        GROUP BY month
      `
      : `
        SELECT
          month,
          SUM(refund_usd) AS refund,
          SUM(is_identity) AS identity_count,
          SUM(is_csv_rate) AS csv_rate_count,
          SUM(CASE WHEN is_identity = 0 AND is_csv_rate = 0 THEN 1 ELSE 0 END) AS unconvertible_count
        FROM (
          SELECT
            substr(order_date, 1, 7) AS month,
            CASE
              WHEN UPPER(payment_currency) = 'USD' THEN refund_amount
              WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
                THEN refund_amount / exchange_rate
            END AS refund_usd,
            CASE WHEN UPPER(payment_currency) = 'USD' THEN 1 ELSE 0 END AS is_identity,
            CASE WHEN UPPER(payment_currency) = 'TRY' AND UPPER(listing_currency) = 'USD' AND exchange_rate > 0
              THEN 1 ELSE 0 END AS is_csv_rate
          FROM v_payments_clean
          WHERE order_date BETWEEN ? AND ?
        ) x
        GROUP BY month
      `;
  const result = await db.prepare(query).bind(range.min, range.max).all<RefundMonthRow>();
  return result.results ?? [];
}

function currencyOf(row: { currency: string | null; currency_count: number } | undefined): string | null {
  if (!row || row.currency_count !== 1) return null;
  return row.currency;
}

function buildOrderMetrics(api: OrderMonthRow | undefined, csv: OrderMonthRow | undefined): FinancialMetric[] {
  const apiCurrency = currencyOf(api);
  const csvCurrency = currencyOf(csv);
  const apiGross = api ? (api.total_price ?? 0) - (api.discount ?? 0) : null;
  const csvGross = csv ? (csv.total_price ?? 0) - (csv.discount ?? 0) : null;

  return [
    buildMetric(
      "grossSales",
      "Gross Sales",
      "API: total_price - discount_amt · CSV: order_value - discount_amount (tax/shipping excluded)",
      apiGross,
      csvGross,
      apiCurrency,
      csvCurrency,
    ),
    buildMetric(
      "discount",
      "Discount",
      "API: discount_amt · CSV: discount_amount",
      api?.discount ?? null,
      csv?.discount ?? null,
      apiCurrency,
      csvCurrency,
    ),
    buildMetric(
      "shipping",
      "Shipping",
      "API: total_shipping_cost · CSV: shipping",
      api?.shipping ?? null,
      csv?.shipping ?? null,
      apiCurrency,
      csvCurrency,
    ),
    buildMetric(
      "tax",
      "Sales Tax",
      "API: total_tax_cost · CSV: sales_tax",
      api?.tax ?? null,
      csv?.tax ?? null,
      apiCurrency,
      csvCurrency,
    ),
    buildMetric(
      "orderTotal",
      "Order Total",
      "API: grandtotal · CSV: order_total (discount applied, tax/shipping included)",
      api?.order_total ?? null,
      csv?.order_total ?? null,
      apiCurrency,
      csvCurrency,
    ),
    buildStubMetric(
      "vat",
      "VAT",
      "API: total_vat_cost · CSV: not exported",
      api?.vat ?? null,
      "The CSV export has no VAT column; this metric cannot be compared yet.",
    ),
  ];
}

function conversionCountsOf(row: { identity_count: number; csv_rate_count: number; unconvertible_count: number } | undefined): ConversionCounts {
  return {
    identity: row?.identity_count ?? 0,
    csvRate: row?.csv_rate_count ?? 0,
    unconvertible: row?.unconvertible_count ?? 0,
  };
}

function buildPaymentMetrics(
  api: PaymentMonthRow | undefined,
  csv: PaymentMonthRow | undefined,
  apiRefund: RefundMonthRow | undefined,
  csvRefund: RefundMonthRow | undefined,
): FinancialMetric[] {
  const apiConversion = conversionCountsOf(api);
  const csvConversion = conversionCountsOf(csv);

  const pairs: Array<[string, string, string, keyof PaymentMonthRow]> = [
    ["paymentGrossOriginal", "Payment Gross (original)", "API: amount_gross · CSV: gross_amount", "gross"],
    ["paymentFeeOriginal", "Processing Fee (original)", "API: amount_fees · CSV: fees", "fees"],
    ["paymentNetOriginal", "Payment Net (original)", "API: amount_net · CSV: net_amount", "net"],
    ["paymentGrossPosted", "Payment Gross (posted)", "API: posted_gross · CSV: posted_gross", "posted_gross"],
    ["paymentFeePosted", "Processing Fee (posted)", "API: posted_fees · CSV: posted_fees", "posted_fees"],
    ["paymentNetPosted", "Payment Net (posted)", "API: posted_net · CSV: posted_net", "posted_net"],
    ["paymentGrossAdjusted", "Payment Gross (adjusted)", "API: adjusted_gross · CSV: adjusted_gross", "adjusted_gross"],
    ["paymentFeeAdjusted", "Processing Fee (adjusted)", "API: adjusted_fees · CSV: adjusted_fees", "adjusted_fees"],
    ["paymentNetAdjusted", "Payment Net (adjusted)", "API: adjusted_net · CSV: adjusted_net", "adjusted_net"],
  ];

  const metrics = pairs.map(([key, label, basis, field]) =>
    buildConvertedMetric(
      key,
      label,
      `${basis} (converted to ${REPORTING_CURRENCY}: same-currency identity or CSV per-row exchange_rate)`,
      (api?.[field] as number | null) ?? null,
      (csv?.[field] as number | null) ?? null,
      apiConversion,
      csvConversion,
    ),
  );

  metrics.push(
    buildConvertedMetric(
      "refund",
      "Refund",
      `API: successful payment_adjustments, always ${REPORTING_CURRENCY} · CSV: refund_amount (converted)`,
      apiRefund?.refund ?? null,
      csvRefund?.refund ?? null,
      conversionCountsOf(apiRefund),
      conversionCountsOf(csvRefund),
    ),
  );

  return metrics;
}

export async function loadMonthlyFinancials(
  db: D1DatabaseWithAll,
  orders: EntityReconciliation,
  payments: EntityReconciliation,
): Promise<MonthlyFinancialsResult> {
  const ordersAvailable =
    orders.readiness.api && orders.readiness.csv && Boolean(orders.coverage.common.min && orders.coverage.common.max);
  const paymentsAvailable =
    payments.readiness.api
    && payments.readiness.csv
    && Boolean(payments.coverage.common.min && payments.coverage.common.max);

  const [
    apiOrderMonths,
    csvOrderMonths,
    apiPaymentMonths,
    csvPaymentMonths,
    apiRefundMonths,
    csvRefundMonths,
  ] = await Promise.all([
    ordersAvailable ? loadOrderMonths(db, "api", orders.coverage.common) : Promise.resolve([]),
    ordersAvailable ? loadOrderMonths(db, "csv", orders.coverage.common) : Promise.resolve([]),
    paymentsAvailable ? loadPaymentMonths(db, "api", payments.coverage.common) : Promise.resolve([]),
    paymentsAvailable ? loadPaymentMonths(db, "csv", payments.coverage.common) : Promise.resolve([]),
    paymentsAvailable ? loadRefundMonths(db, "api", payments.coverage.common) : Promise.resolve([]),
    paymentsAvailable ? loadRefundMonths(db, "csv", payments.coverage.common) : Promise.resolve([]),
  ]);

  const apiOrderByMonth = new Map(apiOrderMonths.map((row) => [row.month, row]));
  const csvOrderByMonth = new Map(csvOrderMonths.map((row) => [row.month, row]));
  const apiPaymentByMonth = new Map(apiPaymentMonths.map((row) => [row.month, row]));
  const csvPaymentByMonth = new Map(csvPaymentMonths.map((row) => [row.month, row]));
  const apiRefundByMonth = new Map(apiRefundMonths.map((row) => [row.month, row]));
  const csvRefundByMonth = new Map(csvRefundMonths.map((row) => [row.month, row]));

  const months = new Set<string>([
    ...apiOrderByMonth.keys(),
    ...csvOrderByMonth.keys(),
    ...apiPaymentByMonth.keys(),
    ...csvPaymentByMonth.keys(),
  ]);

  const entries: MonthlyFinancialEntry[] = Array.from(months)
    .sort()
    .map((month) => {
      const apiOrder = apiOrderByMonth.get(month);
      const csvOrder = csvOrderByMonth.get(month);
      const apiPayment = apiPaymentByMonth.get(month);
      const csvPayment = csvPaymentByMonth.get(month);
      const apiRefund = apiRefundByMonth.get(month);
      const csvRefund = csvRefundByMonth.get(month);

      const orderMetrics = apiOrder || csvOrder ? buildOrderMetrics(apiOrder, csvOrder) : [];
      const paymentMetrics =
        apiPayment || csvPayment
          ? buildPaymentMetrics(apiPayment, csvPayment, apiRefund, csvRefund)
          : [];
      const metrics = [...orderMetrics, ...paymentMetrics];

      return {
        month,
        orderCount:
          apiOrder || csvOrder ? { api: Number(apiOrder?.count ?? 0), csv: Number(csvOrder?.count ?? 0) } : null,
        paymentCount:
          apiPayment || csvPayment
            ? { api: Number(apiPayment?.count ?? 0), csv: Number(csvPayment?.count ?? 0) }
            : null,
        metrics,
        status: deriveMonthStatus(metrics),
      };
    });

  return {
    months: entries,
    status: deriveOverallMonthlyStatus(entries.map((entry) => entry.status)),
    ordersAvailable,
    paymentsAvailable,
  };
}

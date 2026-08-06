export type CurrencyQuality = {
  valid: boolean;
  expectedCurrency: string;
  currencies: string[];
  missingCurrencyRows: number;
};

export type PaymentDataSource = "csv_upload" | "etsy_api" | "etsy_api+csv";

export type PaymentFinancialRow = {
  orderId?: string | null;
  grossAmount: number | null;
  fees: number | null;
  netAmount: number | null;
  exchangeRate: number | null;
  paymentCurrency: string | null;
  listingCurrency: string | null;
  dataSource: string | null;
};

export type PaymentFinancialSummary = {
  valid: boolean;
  paymentRowCount: number;
  invalidRowCount: number;
  coveredOrderCount: number;
  expectedOrderCount: number | null;
  paymentCurrencies: string[];
  listingCurrencies: string[];
  paymentGrossUsd: number | null;
  etsyFeesUsd: number | null;
  netRevenueUsd: number | null;
  reconciliationDeltaUsd: number | null;
};

export type PeriodFinancialQuality = {
  label: string;
  orders: number;
  orderCurrency: CurrencyQuality;
  /** Rows where discount Money disagreed with order currency (view sets discount NULL). */
  discountWithheldRows?: number;
  payments: PaymentFinancialSummary;
};

function unique(values: Array<string | null>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort();
}

export function calculateGrossSales(
  listValue: number | null | undefined,
  discounts: number | null | undefined,
): number {
  return (listValue ?? 0) - (discounts ?? 0);
}

export function assessCurrency(
  currencies: string[],
  missingCurrencyRows: number,
  expectedCurrency = "USD",
): CurrencyQuality {
  const normalized = unique(currencies.map((currency) => currency.trim().toUpperCase()));
  return {
    valid:
      missingCurrencyRows === 0
      && normalized.length === 1
      && normalized[0] === expectedCurrency,
    expectedCurrency,
    currencies: normalized,
    missingCurrencyRows,
  };
}

function hasFiniteAmounts(row: PaymentFinancialRow): boolean {
  return (
    typeof row.grossAmount === "number"
    && Number.isFinite(row.grossAmount)
    && typeof row.fees === "number"
    && Number.isFinite(row.fees)
    && typeof row.netAmount === "number"
    && Number.isFinite(row.netAmount)
  );
}

/**
 * Rate availability drives USD conversion, not data source alone. CSV uploads
 * Currency authority is the payment Money currency exposed as payment_currency
 * (gross/fees/net must agree in the canonical view). Never use top-level
 * Payment.currency. CSV enrichment may backfill exchange_rate for TRY Money
 * against a USD listing; USD Money always converts with identity (rate 1) and
 * must never be divided by a TRY→USD rate.
 */
function evaluateRow(row: PaymentFinancialRow): { valid: boolean; rate: number | null } {
  if (!hasFiniteAmounts(row)) {
    return { valid: false, rate: null };
  }

  const paymentCurrency = row.paymentCurrency?.trim().toUpperCase() ?? null;
  const listingCurrency = row.listingCurrency?.trim().toUpperCase() ?? null;

  // Money already denominated in USD → identity. Listing currency / CSV rate
  // must not alter USD amounts.
  if (paymentCurrency === "USD") {
    return { valid: true, rate: 1 };
  }

  const rateOk =
    typeof row.exchangeRate === "number"
    && Number.isFinite(row.exchangeRate)
    && row.exchangeRate > 0;
  const valid = paymentCurrency === "TRY" && listingCurrency === "USD" && rateOk;
  return { valid, rate: valid ? row.exchangeRate : null };
}

export function summarizePaymentFinancials(
  rows: PaymentFinancialRow[],
): PaymentFinancialSummary {
  let paymentGrossUsd = 0;
  let etsyFeesUsd = 0;
  let netRevenueUsd = 0;
  let invalidRowCount = 0;

  for (const row of rows) {
    const { valid: isValid, rate } = evaluateRow(row);

    if (!isValid || rate === null) {
      invalidRowCount += 1;
      continue;
    }

    paymentGrossUsd += row.grossAmount! / rate;
    etsyFeesUsd += row.fees! / rate;
    netRevenueUsd += row.netAmount! / rate;
  }

  const valid = invalidRowCount === 0;
  return {
    valid,
    paymentRowCount: rows.length,
    invalidRowCount,
    coveredOrderCount: countCoveredOrders(rows),
    expectedOrderCount: null,
    paymentCurrencies: unique(rows.map((row) => row.paymentCurrency?.trim().toUpperCase() ?? null)),
    listingCurrencies: unique(rows.map((row) => row.listingCurrency?.trim().toUpperCase() ?? null)),
    paymentGrossUsd: valid ? paymentGrossUsd : null,
    etsyFeesUsd: valid ? etsyFeesUsd : null,
    netRevenueUsd: valid ? netRevenueUsd : null,
    reconciliationDeltaUsd: valid
      ? paymentGrossUsd - etsyFeesUsd - netRevenueUsd
      : null,
  };
}

/** Distinct order IDs present on payment rows (multi-payment orders count once). */
export function countCoveredOrders(
  rows: ReadonlyArray<Pick<PaymentFinancialRow, "orderId">>,
  selectedOrderIds?: ReadonlySet<string>,
): number {
  const covered = new Set<string>();

  for (const row of rows) {
    const orderId = row.orderId?.trim();
    if (!orderId) {
      continue;
    }
    if (selectedOrderIds && !selectedOrderIds.has(orderId)) {
      continue;
    }
    covered.add(orderId);
  }

  return covered.size;
}

/**
 * An empty payment-row list is indistinguishable from "$0 of net revenue" in
 * summarizePaymentFinancials (invalidRowCount stays 0, so valid stays true).
 * Partial coverage (e.g. 10 selected orders, payments for only 6) is also not
 * a complete total — force the summary to unavailable so callers don't publish
 * a misleading Net Revenue figure. Multiple valid payment rows for one order
 * still count as full coverage for that order.
 */
export function requirePaymentCoverage(
  summary: PaymentFinancialSummary,
  orderCount: number,
  coveredOrderCount: number = summary.coveredOrderCount,
): PaymentFinancialSummary {
  const incomplete = orderCount > 0 && coveredOrderCount < orderCount;

  if (!incomplete) {
    return {
      ...summary,
      coveredOrderCount,
      expectedOrderCount: orderCount,
    };
  }

  return {
    ...summary,
    valid: false,
    coveredOrderCount,
    expectedOrderCount: orderCount,
    paymentGrossUsd: null,
    etsyFeesUsd: null,
    netRevenueUsd: null,
    reconciliationDeltaUsd: null,
  };
}

export function buildFinancialQualityWarnings(
  periods: ReadonlyArray<PeriodFinancialQuality>,
): string[] {
  const warnings: string[] = [];

  for (const period of periods) {
    if (period.orders > 0 && !period.orderCurrency.valid) {
      warnings.push(
        `The ${period.label} period Gross Sales is unavailable because order currency is not complete USD.`,
      );
    }
    if (period.orders > 0 && (period.discountWithheldRows ?? 0) > 0) {
      warnings.push(
        `The ${period.label} period Gross Sales is unavailable because at least one order discount currency disagreed with order currency.`,
      );
    }
    if (
      period.orders > 0
      && (period.payments.coveredOrderCount < period.orders
        || period.payments.paymentRowCount === 0)
    ) {
      warnings.push(
        `The ${period.label} period Etsy Fees and Net Revenue are unavailable because payment data covers ${period.payments.coveredOrderCount} of ${period.orders} selected orders.`,
      );
    } else if (!period.payments.valid) {
      warnings.push(
        `The ${period.label} period has ${period.payments.invalidRowCount} payment row(s) with an unsupported currency, missing amount, or invalid exchange rate.`,
      );
    }
    if (
      period.payments.reconciliationDeltaUsd !== null
      && Math.abs(period.payments.reconciliationDeltaUsd) > 0.02
    ) {
      warnings.push(
        `The ${period.label} period payment totals do not reconcile within USD 0.02.`,
      );
    }
  }

  return warnings;
}

import { queryAll, queryFirst, type D1Database } from "../reports/_summary";
import {
  assessCurrency,
  buildFinancialQualityWarnings,
  calculateGrossSales,
  countCoveredOrders,
  requirePaymentCoverage,
  summarizePaymentFinancials,
  type PaymentFinancialRow,
} from "../intelligence/_financials";
import {
  sumSuccessfulAdjustments,
  type AdjustmentInput,
} from "../intelligence/_refunds";

export type CommerceSummaryStatus = "complete" | "partial" | "failed" | "running";

export type MoneyField = {
  value: number | null;
  currency: "USD";
  available: boolean;
};

export type CommerceSummary = {
  runId: string;
  period: { fromDate: string; toDate: string };
  status: CommerceSummaryStatus;
  recordsFetched: number;
  orderCount: number;
  unitsSold: number;
  grossSales: MoneyField;
  discounts: MoneyField;
  refunds: MoneyField;
  etsyFees: MoneyField;
  netSales: MoneyField;
  warnings: string[];
};

type JobRow = {
  id: string;
  shop_id: string;
  status: string;
  period_from_ts: number | null;
  period_to_ts: number | null;
};

type AggregateRow = {
  orderCount: number | null;
  listValue: number | null;
  discounts: number | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
  withheldDiscountRows: number | null;
};

type UnitsRow = {
  unitsSold: number | null;
};

type FetchedRow = {
  total: number | null;
};

type CoverageStatusRow = {
  status: string;
};

type AdjustmentRow = {
  is_success: number;
  total_adjustment_amount: number | null;
  /** Settlement currency of the parent payment; adjustments carry none. */
  parent_currency: string | null;
};

type ReceiptRefundRow = {
  amount: number | null;
  amount_divisor: number | null;
  amount_currency: string | null;
};

type CsvRefundRow = {
  refund_amount: number | null;
  payment_currency: string | null;
  listing_currency: string | null;
  exchange_rate: number | null;
};

function toNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function currencyValues(value: string | null | undefined): string[] {
  return value?.split(",").map((currency) => currency.trim()).filter(Boolean) ?? [];
}

function utcDateFromUnixSeconds(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function periodDates(fromTs: number, toExclusiveTs: number): { fromDate: string; toDate: string } {
  return {
    fromDate: utcDateFromUnixSeconds(fromTs),
    toDate: utcDateFromUnixSeconds(toExclusiveTs - 1),
  };
}

function moneyField(value: number | null, available: boolean): MoneyField {
  return {
    value: available ? value : null,
    currency: "USD",
    available,
  };
}

function deriveStatusFromJob(jobStatus: string): CommerceSummaryStatus {
  switch (jobStatus) {
    case "completed":
      return "complete";
    case "partial":
      return "partial";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "running";
  }
}

function normalizeCoverageStatus(status: string): CommerceSummaryStatus {
  if (status === "complete" || status === "partial" || status === "failed" || status === "running") {
    return status;
  }
  return "partial";
}

/**
 * Etsy's payments CSV mixes two currencies in one row: Gross/Fees/Net are in
 * the settlement currency (TRY for this shop) but "Refund Amount" is in the
 * LISTING currency. Verified on production D1 (2026-08-06): the two CSV refund
 * rows carry 4.51 and 5.08, which match the USD Money amounts in
 * etsy_api_receipt_refunds for the same receipts to the cent. Dividing them by
 * the TRY rate — as this function used to — reported $0.11 and $0.12.
 *
 * So the refund is only convertible when the listing currency is USD; the
 * settlement currency and exchange rate are irrelevant to it.
 */
function csvRefundToUsd(row: CsvRefundRow): number | null {
  const amount = row.refund_amount;
  if (amount === null) {
    return null;
  }
  if (amount === 0) {
    return 0;
  }

  const listingCurrency = row.listing_currency?.trim().toUpperCase() ?? null;
  return listingCurrency === "USD" ? amount : null;
}

/**
 * Refunds are reported in the month the refund happened, not the month of the
 * order it reverses. Production has a 2026-04-18 order refunded on 2026-08-04;
 * bucketing by order date would silently rewrite a closed month.
 *
 * Source priority:
 *  1. `etsy_api_receipt_refunds` — a real Etsy Money object with its own
 *     `amount_divisor` and `amount_currency`, and the only source that carries
 *     a refund date. This is the authority.
 *  2. Successful payment adjustments that no receipt refund explains. These
 *     have no currency column at all (see migration 0013), so they can only be
 *     trusted when the parent payment settles in USD; otherwise the period is
 *     unavailable rather than guessed.
 *  3. CSV payment rows for orders with no API refund, converted by
 *     `csvRefundToUsd`.
 */
async function loadRefundsUsd(
  db: D1Database,
  fromDate: string,
  toDate: string,
): Promise<{ value: number | null; available: boolean }> {
  const [receiptRefunds, adjustments, csvRows] = await Promise.all([
    queryAll<ReceiptRefundRow>(
      db,
      `
        SELECT amount, amount_divisor, amount_currency
        FROM etsy_api_receipt_refunds
        WHERE UPPER(status) = 'SUCCESS'
          AND date(created_timestamp, 'unixepoch') BETWEEN ? AND ?
      `,
      [fromDate, toDate],
    ),
    queryAll<AdjustmentRow>(
      db,
      `
        SELECT pa.is_success, pa.total_adjustment_amount, p.currency AS parent_currency
        FROM etsy_api_payment_adjustments pa
        JOIN etsy_api_payments p ON p.payment_id = pa.payment_id
        WHERE date(p.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          AND NOT EXISTS (
            SELECT 1 FROM etsy_api_receipt_refunds rf WHERE rf.receipt_id = p.receipt_id
          )
      `,
      [fromDate, toDate],
    ),
    queryAll<CsvRefundRow>(
      db,
      `
        SELECT v.refund_amount, v.payment_currency, v.listing_currency, v.exchange_rate
        FROM v_payments_canonical v
        WHERE v.order_date BETWEEN ? AND ?
          AND v.data_source = 'csv_upload'
          AND NOT EXISTS (
            SELECT 1 FROM etsy_api_receipt_refunds rf WHERE rf.receipt_id = v.order_id
          )
      `,
      [fromDate, toDate],
    ),
  ]);

  let apiRefundUsd = 0;
  for (const row of receiptRefunds) {
    const divisor = row.amount_divisor;
    const currency = row.amount_currency?.trim().toUpperCase() ?? null;
    if (
      row.amount === null
      || divisor === null
      || divisor <= 0
      || currency !== "USD"
    ) {
      return { value: null, available: false };
    }
    apiRefundUsd += row.amount / divisor;
  }

  const hasNonUsdAdjustment = adjustments.some(
    (row) =>
      row.is_success === 1
      && (row.parent_currency?.trim().toUpperCase() ?? null) !== "USD",
  );
  if (hasNonUsdAdjustment) {
    return { value: null, available: false };
  }

  const adjustmentResult = sumSuccessfulAdjustments(
    adjustments.map(
      (row): AdjustmentInput => ({
        isSuccess: row.is_success === 1,
        totalAdjustmentAmountCents: row.total_adjustment_amount,
      }),
    ),
  );
  if (adjustmentResult.refundAmount === null) {
    return { value: null, available: false };
  }

  let csvRefundUsd = 0;
  for (const row of csvRows) {
    const converted = csvRefundToUsd(row);
    if (converted === null) {
      return { value: null, available: false };
    }
    csvRefundUsd += converted;
  }

  return {
    value: apiRefundUsd + adjustmentResult.refundAmount + csvRefundUsd,
    available: true,
  };
}

export async function loadCommerceSummary(
  db: D1Database,
  runId: string,
): Promise<CommerceSummary | null> {
  const job = await queryFirst<JobRow>(
    db,
    `
      SELECT id, shop_id, status, period_from_ts, period_to_ts
      FROM etsy_sync_jobs
      WHERE id = ?
    `,
    [runId],
  );

  if (!job) {
    return null;
  }

  if (job.period_from_ts === null || job.period_to_ts === null) {
    throw new Error("commerce_summary_missing_period");
  }

  const period = periodDates(job.period_from_ts, job.period_to_ts);
  const { fromDate, toDate } = period;

  const coverageRow = await queryFirst<CoverageStatusRow>(
    db,
    `
      SELECT status
      FROM etsy_commerce_period_coverage
      WHERE shop_id = ? AND from_ts = ? AND to_ts = ?
      LIMIT 1
    `,
    [job.shop_id, job.period_from_ts, job.period_to_ts],
  );

  const status = coverageRow
    ? normalizeCoverageStatus(coverageRow.status)
    : deriveStatusFromJob(job.status);

  const fetchedRow = await queryFirst<FetchedRow>(
    db,
    `
      SELECT COALESCE(SUM(fetched_count), 0) AS total
      FROM etsy_sync_job_resources
      WHERE run_id = ?
    `,
    [runId],
  );

  const [aggregate, unitsRow, paymentRows, refunds] = await Promise.all([
    queryFirst<AggregateRow>(
      db,
      `
        SELECT
          COUNT(DISTINCT order_id) AS orderCount,
          SUM(order_value) AS listValue,
          SUM(
            CASE WHEN COALESCE(discount_withheld, 0) = 0
              THEN COALESCE(discount_amount, 0) ELSE 0 END
          ) AS discounts,
          GROUP_CONCAT(DISTINCT order_currency) AS currencies,
          SUM(CASE WHEN order_currency IS NULL OR TRIM(order_currency) = '' THEN 1 ELSE 0 END)
            AS missingCurrencyRows,
          SUM(COALESCE(discount_withheld, 0)) AS withheldDiscountRows
        FROM v_orders_canonical
        WHERE sale_date BETWEEN ? AND ?
      `,
      [fromDate, toDate],
    ),
    queryFirst<UnitsRow>(
      db,
      `
        SELECT COALESCE(SUM(quantity), 0) AS unitsSold
        FROM v_order_items_canonical
        WHERE sale_date BETWEEN ? AND ?
      `,
      [fromDate, toDate],
    ),
    queryAll<PaymentFinancialRow>(
      db,
      `
        SELECT
          order_id AS orderId,
          gross_amount AS grossAmount,
          fees,
          net_amount AS netAmount,
          exchange_rate AS exchangeRate,
          payment_currency AS paymentCurrency,
          listing_currency AS listingCurrency,
          data_source AS dataSource
        FROM v_payments_canonical
        WHERE order_date BETWEEN ? AND ?
      `,
      [fromDate, toDate],
    ),
    loadRefundsUsd(db, fromDate, toDate),
  ]);

  const orderCount = toNumber(aggregate?.orderCount);
  const listValue = toNumber(aggregate?.listValue);
  const discountsTotal = toNumber(aggregate?.discounts);
  const unitsSold = toNumber(unitsRow?.unitsSold);
  const recordsFetched = toNumber(fetchedRow?.total);

  const orderCurrency = assessCurrency(
    currencyValues(aggregate?.currencies ?? null),
    toNumber(aggregate?.missingCurrencyRows),
    "USD",
  );
  const withheldDiscountRows = toNumber(aggregate?.withheldDiscountRows);

  const grossSalesValue = calculateGrossSales(listValue, discountsTotal);
  const orderMetricsAvailable =
    orderCount === 0 || (orderCurrency.valid && withheldDiscountRows === 0);

  const paymentSummary = requirePaymentCoverage(
    summarizePaymentFinancials(paymentRows),
    orderCount,
    countCoveredOrders(paymentRows),
  );

  const warnings = buildFinancialQualityWarnings([
    {
      label: "commerce period",
      orders: orderCount,
      orderCurrency,
      discountWithheldRows: withheldDiscountRows,
      payments: paymentSummary,
    },
  ]);

  if (!refunds.available) {
    warnings.push("Refunds are unavailable because at least one payment refund could not be derived.");
  }

  return {
    runId,
    period,
    status,
    recordsFetched,
    orderCount,
    unitsSold,
    grossSales: moneyField(grossSalesValue, orderMetricsAvailable),
    discounts: moneyField(discountsTotal, orderMetricsAvailable),
    refunds: moneyField(refunds.value, refunds.available),
    etsyFees: moneyField(paymentSummary.etsyFeesUsd, paymentSummary.valid),
    netSales: moneyField(paymentSummary.netRevenueUsd, paymentSummary.valid),
    warnings,
  };
}

import { buildReportWhere, parseReportFilters, type ParsedReportFilters } from "../_filters";
import { collectMixedCurrencyWarning, toNumber } from "../_money";
import { summarizePaymentFinancials, type PaymentFinancialRow } from "../../intelligence/_financials";
import { aggregateProvenance, type DataProvenance } from "../../intelligence/_provenance";
import {
  buildCountKpi,
  buildDaysKpi,
  buildMoneyKpi,
  buildPercentKpi,
  buildRatioKpi,
  getComparisonDateRange,
  jsonError,
  queryAll,
  queryFirst,
  serializeFilters,
  type InsightBlock,
  type KpiCard,
  type SummaryRequestContext,
  withComparisonDateRange,
} from "../_summary";

type CurrencyMetricRow = {
  currency: string | null;
  amount: number | null;
};

type CountMetricRow = {
  paymentCount: number | null;
  averageExchangeRate: number | null;
  weightedAverageExchangeRate: number | null;
  averagePayoutDelayDays: number | null;
};

type MonthlyMoneyRow = {
  month: string;
  paymentCurrency: string | null;
  listingCurrency?: string | null;
  grossAmount?: number | null;
  netAmount?: number | null;
  fees?: number | null;
  refundAmount?: number | null;
  refundCount?: number | null;
  effectiveFeeRate?: number | null;
  avgExchangeRate?: number | null;
  weightedAvgExchangeRate?: number | null;
};

type ListingDistributionRow = {
  listingCurrency: string | null;
  bucket: string;
  paymentCount: number | null;
  listingAmount: number | null;
};

type PaymentStatusRow = {
  status: string | null;
  paymentCurrency: string | null;
  paymentCount: number | null;
  grossAmount: number | null;
  netAmount: number | null;
};

type LowPricePenaltyRow = {
  listingCurrency: string | null;
  paymentCurrency: string | null;
  lowPriceFeeRate: number | null;
  higherPriceFeeRate: number | null;
};

const FILTER_COLUMNS = {
  date: "order_date",
  currency: ["payment_currency", "listing_currency"],
  status: "payment_status",
  orderId: "order_id",
  paymentId: "payment_id",
  q: ["payment_id", "order_id", "payment_status", "payment_currency", "listing_currency"],
} as const;

function getPaymentsWhere(filters: ParsedReportFilters) {
  return buildReportWhere(filters, {
    columns: FILTER_COLUMNS,
  });
}

function appendCondition(whereSql: string, condition: string): string {
  return whereSql ? `${whereSql} AND ${condition}` : `WHERE ${condition}`;
}

function findCurrencyAmount(rows: CurrencyMetricRow[], currency: string | null): number | null {
  const match = rows.find((row) => (row.currency ?? "Unknown") === (currency ?? "Unknown"));
  return match ? toNumber(match.amount) : null;
}

export async function onRequestGet(context: SummaryRequestContext): Promise<Response> {
  let filters: ParsedReportFilters;

  try {
    filters = parseReportFilters(context.request);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : "invalid_filters");
  }

  const comparison = getComparisonDateRange(filters);
  const comparisonFilters = withComparisonDateRange(filters, comparison);
  const { whereSql, bindings } = getPaymentsWhere(filters);
  const comparisonWhere = getPaymentsWhere(comparisonFilters);

  try {
    const [
      countMetrics,
      comparisonCountMetrics,
      listingRevenueRows,
      previousListingRevenueRows,
      grossAmountRows,
      previousGrossAmountRows,
      feeRows,
      previousFeeRows,
      netAmountRows,
      previousNetAmountRows,
      feeRateRows,
      previousFeeRateRows,
      refundRows,
      previousRefundRows,
      refundRateRows,
      previousRefundRateRows,
      averageNetPerPaymentRows,
      previousAverageNetPerPaymentRows,
      grossVsNetTrendRows,
      feeRateTrendRows,
      feesTrendRows,
      refundTrendRows,
      listingDistributionRows,
      exchangeRateTrendRows,
      paymentStatusRows,
      lowPricePenaltyRows,
      paymentFinancialRows,
    ] = await Promise.all([
      queryFirst<CountMetricRow>(
        context.env.DB,
        `
          SELECT
            COUNT(DISTINCT payment_id) AS paymentCount,
            AVG(CASE WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 THEN exchange_rate END) AS averageExchangeRate,
            SUM(exchange_rate * listing_amount) * 1.0 / NULLIF(SUM(listing_amount), 0) AS weightedAverageExchangeRate,
            AVG(
              CASE
                WHEN order_date IS NOT NULL AND funds_available_date IS NOT NULL
                THEN julianday(funds_available_date) - julianday(order_date)
                ELSE NULL
              END
            ) AS averagePayoutDelayDays
          FROM v_payments_canonical
          ${whereSql}
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve(null) : queryFirst<CountMetricRow>(
        context.env.DB,
        `
          SELECT
            COUNT(DISTINCT payment_id) AS paymentCount,
            AVG(CASE WHEN exchange_rate IS NOT NULL AND exchange_rate > 0 THEN exchange_rate END) AS averageExchangeRate,
            SUM(exchange_rate * listing_amount) * 1.0 / NULLIF(SUM(listing_amount), 0) AS weightedAverageExchangeRate,
            AVG(
              CASE
                WHEN order_date IS NOT NULL AND funds_available_date IS NOT NULL
                THEN julianday(funds_available_date) - julianday(order_date)
                ELSE NULL
              END
            ) AS averagePayoutDelayDays
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT listing_currency AS currency, SUM(listing_amount) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY listing_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT listing_currency AS currency, SUM(listing_amount) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY listing_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(gross_amount) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(gross_amount) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(fees) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(fees) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(net_amount) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(net_amount) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(fees) * 1.0 / NULLIF(SUM(gross_amount), 0) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(fees) * 1.0 / NULLIF(SUM(gross_amount), 0) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(refund_amount) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(refund_amount) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(refund_amount) * 1.0 / NULLIF(SUM(gross_amount), 0) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(refund_amount) * 1.0 / NULLIF(SUM(gross_amount), 0) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(net_amount) * 1.0 / NULLIF(COUNT(DISTINCT payment_id), 0) AS amount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_currency
        `,
        bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT payment_currency AS currency, SUM(net_amount) * 1.0 / NULLIF(COUNT(DISTINCT payment_id), 0) AS amount
          FROM v_payments_canonical
          ${comparisonWhere.whereSql}
          GROUP BY payment_currency
        `,
        comparisonWhere.bindings,
      ),
      queryAll<MonthlyMoneyRow>(
        context.env.DB,
        `
          SELECT
            substr(order_date, 1, 7) AS month,
            payment_currency AS paymentCurrency,
            SUM(gross_amount) AS grossAmount,
            SUM(net_amount) AS netAmount
          FROM v_payments_canonical
          ${appendCondition(whereSql, "order_date IS NOT NULL")}
          GROUP BY month, payment_currency
          ORDER BY month ASC, payment_currency ASC
        `,
        bindings,
      ),
      queryAll<MonthlyMoneyRow>(
        context.env.DB,
        `
          SELECT
            substr(order_date, 1, 7) AS month,
            payment_currency AS paymentCurrency,
            SUM(fees) * 1.0 / NULLIF(SUM(gross_amount), 0) AS effectiveFeeRate
          FROM v_payments_canonical
          ${appendCondition(whereSql, "order_date IS NOT NULL")}
          GROUP BY month, payment_currency
          ORDER BY month ASC, payment_currency ASC
        `,
        bindings,
      ),
      queryAll<MonthlyMoneyRow>(
        context.env.DB,
        `
          SELECT
            substr(order_date, 1, 7) AS month,
            payment_currency AS paymentCurrency,
            SUM(fees) AS fees
          FROM v_payments_canonical
          ${appendCondition(whereSql, "order_date IS NOT NULL")}
          GROUP BY month, payment_currency
          ORDER BY month ASC, payment_currency ASC
        `,
        bindings,
      ),
      queryAll<MonthlyMoneyRow>(
        context.env.DB,
        `
          SELECT
            substr(order_date, 1, 7) AS month,
            payment_currency AS paymentCurrency,
            SUM(refund_amount) AS refundAmount,
            COUNT(CASE WHEN refund_amount > 0 THEN 1 END) AS refundCount
          FROM v_payments_canonical
          ${appendCondition(whereSql, "order_date IS NOT NULL")}
          GROUP BY month, payment_currency
          ORDER BY month ASC, payment_currency ASC
        `,
        bindings,
      ),
      queryAll<ListingDistributionRow>(
        context.env.DB,
        `
          SELECT
            listing_currency AS listingCurrency,
            CASE
              WHEN listing_amount < 3 THEN '0-3'
              WHEN listing_amount < 6 THEN '3-6'
              WHEN listing_amount < 10 THEN '6-10'
              WHEN listing_amount < 20 THEN '10-20'
              ELSE '20+'
            END AS bucket,
            COUNT(DISTINCT payment_id) AS paymentCount,
            SUM(listing_amount) AS listingAmount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY listing_currency, bucket
          ORDER BY listing_currency ASC, bucket ASC
        `,
        bindings,
      ),
      queryAll<MonthlyMoneyRow>(
        context.env.DB,
        `
          SELECT
            substr(order_date, 1, 7) AS month,
            listing_currency AS listingCurrency,
            payment_currency AS paymentCurrency,
            AVG(exchange_rate) AS avgExchangeRate,
            SUM(exchange_rate * listing_amount) * 1.0 / NULLIF(SUM(listing_amount), 0) AS weightedAvgExchangeRate
          FROM v_payments_canonical
          ${appendCondition(whereSql, "order_date IS NOT NULL AND exchange_rate IS NOT NULL AND exchange_rate > 0")}
          GROUP BY month, listing_currency, payment_currency
          ORDER BY month ASC, listing_currency ASC, payment_currency ASC
        `,
        bindings,
      ),
      queryAll<PaymentStatusRow>(
        context.env.DB,
        `
          SELECT
            payment_status AS status,
            payment_currency AS paymentCurrency,
            COUNT(DISTINCT payment_id) AS paymentCount,
            SUM(gross_amount) AS grossAmount,
            SUM(net_amount) AS netAmount
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY payment_status, payment_currency
          ORDER BY paymentCount DESC, grossAmount DESC
        `,
        bindings,
      ),
      queryAll<LowPricePenaltyRow>(
        context.env.DB,
        `
          SELECT
            listing_currency AS listingCurrency,
            payment_currency AS paymentCurrency,
            SUM(CASE WHEN listing_amount < 5 THEN fees ELSE 0 END) * 1.0
              / NULLIF(SUM(CASE WHEN listing_amount < 5 THEN gross_amount ELSE 0 END), 0) AS lowPriceFeeRate,
            SUM(CASE WHEN listing_amount >= 5 THEN fees ELSE 0 END) * 1.0
              / NULLIF(SUM(CASE WHEN listing_amount >= 5 THEN gross_amount ELSE 0 END), 0) AS higherPriceFeeRate
          FROM v_payments_canonical
          ${whereSql}
          GROUP BY listing_currency, payment_currency
        `,
        bindings,
      ),
      // Normalized USD business metrics: each payment row converted with its own
      // exchange_rate (see functions/api/intelligence/_financials.ts), never an
      // averaged rate. Distinct from the raw per-currency KPIs below, which are
      // settlement/audit figures and are labeled accordingly.
      queryAll<PaymentFinancialRow>(
        context.env.DB,
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
          ${whereSql}
        `,
        bindings,
      ),
    ]);

    const warnings: string[] = [];
    const listingCurrencyWarning = collectMixedCurrencyWarning(listingRevenueRows, "Listing revenue");
    if (listingCurrencyWarning) {
      warnings.push(listingCurrencyWarning);
    }
    const paymentCurrencyWarning = collectMixedCurrencyWarning(grossAmountRows, "Payment summary");
    if (paymentCurrencyWarning) {
      warnings.push(paymentCurrencyWarning);
    }

    const paymentFinancials = summarizePaymentFinancials(paymentFinancialRows);
    const paymentProvenance: DataProvenance | null = aggregateProvenance(
      paymentFinancialRows.map((row) => row.dataSource),
    );
    if (paymentFinancialRows.length > 0 && !paymentFinancials.valid) {
      warnings.push(
        `USD Business Metrics (Etsy Fees, Net Revenue) are unavailable: ${paymentFinancials.invalidRowCount} of ${paymentFinancials.paymentRowCount} payment row(s) have unsupported currency or missing exchange rate.`,
      );
    }

    const kpis: KpiCard[] = [
      buildCountKpi(
        "payment_count",
        "Payment Count",
        toNumber(countMetrics?.paymentCount),
        comparison.mode === "none" ? null : toNumber(comparisonCountMetrics?.paymentCount),
      ),
    ];

    if (paymentFinancials.etsyFeesUsd !== null && paymentFinancials.etsyFeesUsd > 0) {
      kpis.push(
        buildMoneyKpi(
          "etsy_fees_usd",
          "Etsy Fees (USD, normalized)",
          paymentFinancials.etsyFeesUsd,
          "USD",
          null,
        ),
      );
    }

    if (paymentFinancials.netRevenueUsd !== null && paymentFinancials.netRevenueUsd > 0) {
      kpis.push(
        buildMoneyKpi(
          "net_revenue_usd",
          "Net Revenue (USD, normalized)",
          paymentFinancials.netRevenueUsd,
          "USD",
          null,
        ),
      );
    }

    for (const row of listingRevenueRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `total_listing_revenue_${currencyKey}`,
          `Total Listing Revenue (${row.currency ?? "Unknown"}) — Settlement`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousListingRevenueRows, row.currency),
        ),
      );
    }

    for (const row of grossAmountRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `gross_payment_amount_${currencyKey}`,
          `Gross Payment Amount (${row.currency ?? "Unknown"}) — Settlement`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousGrossAmountRows, row.currency),
        ),
      );
    }

    for (const row of feeRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `total_fees_paid_${currencyKey}`,
          `Total Fees Paid (${row.currency ?? "Unknown"}) — Settlement`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousFeeRows, row.currency),
        ),
      );
    }

    for (const row of netAmountRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `total_net_payout_${currencyKey}`,
          `Total Net Payout (${row.currency ?? "Unknown"}) — Settlement`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousNetAmountRows, row.currency),
        ),
      );
    }

    for (const row of feeRateRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildPercentKpi(
          `effective_fee_rate_${currencyKey}`,
          `Effective Fee Rate (${row.currency ?? "Unknown"})`,
          row.amount ?? null,
          comparison.mode === "none" ? null : findCurrencyAmount(previousFeeRateRows, row.currency),
        ),
      );
    }

    for (const row of refundRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `total_refunds_${currencyKey}`,
          `Total Refunds (${row.currency ?? "Unknown"}) — Settlement`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousRefundRows, row.currency),
        ),
      );
    }

    for (const row of refundRateRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildPercentKpi(
          `refund_rate_${currencyKey}`,
          `Refund Rate (${row.currency ?? "Unknown"})`,
          row.amount ?? null,
          comparison.mode === "none" ? null : findCurrencyAmount(previousRefundRateRows, row.currency),
        ),
      );
    }

    kpis.push(
      buildRatioKpi(
        "average_exchange_rate",
        "Average Exchange Rate",
        countMetrics?.averageExchangeRate ?? null,
        comparison.mode === "none" ? null : comparisonCountMetrics?.averageExchangeRate ?? null,
      ),
      buildRatioKpi(
        "weighted_average_exchange_rate",
        "Weighted Average Exchange Rate",
        countMetrics?.weightedAverageExchangeRate ?? null,
        comparison.mode === "none" ? null : comparisonCountMetrics?.weightedAverageExchangeRate ?? null,
      ),
      buildDaysKpi(
        "average_payout_delay_days",
        "Average Payout Delay",
        countMetrics?.averagePayoutDelayDays ?? null,
        comparison.mode === "none" ? null : comparisonCountMetrics?.averagePayoutDelayDays ?? null,
      ),
    );

    for (const row of averageNetPerPaymentRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `average_net_payout_per_payment_${currencyKey}`,
          `Average Net Payout per Payment (${row.currency ?? "Unknown"}) — Settlement`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousAverageNetPerPaymentRows, row.currency),
        ),
      );
    }

    const insights: InsightBlock[] = [];

    for (const row of feeRateRows) {
      const value = toNumber(row.amount);
      insights.push({
        key: `fee_bite_${row.currency ?? "unknown"}`,
        title: `Fee Bite (${row.currency ?? "Unknown"})`,
        severity: value >= 0.2 ? "warning" : value >= 0.12 ? "opportunity" : "positive",
        message: value >= 0.2
          ? `Fees consume ${(value * 100).toFixed(1)}% of gross payment in this currency.`
          : value >= 0.12
            ? `Fees consume ${(value * 100).toFixed(1)}% of gross payment. Review whether higher-AOV bundles can improve net payout.`
            : `Fee rate looks relatively healthy at ${(value * 100).toFixed(1)}% of gross payment.`,
      });
    }

    const lowPricePenalty = lowPricePenaltyRows.find((row) => {
      const low = toNumber(row.lowPriceFeeRate);
      const high = toNumber(row.higherPriceFeeRate);
      return low > 0 && high > 0 && low - high >= 0.05;
    });

    if (lowPricePenalty) {
      insights.push({
        key: "low_price_penalty",
        title: "Low-Price Penalty",
        severity: "opportunity",
        message: `Low-priced payments in ${lowPricePenalty.listingCurrency ?? "Unknown"} show a materially higher fee rate than higher-priced payments.`,
        action: "Review bundles or higher-value packs to reduce fixed-fee pressure.",
      });
    }

    for (const row of refundRateRows) {
      const current = toNumber(row.amount);
      const previous = findCurrencyAmount(previousRefundRateRows, row.currency);
      if (previous !== null && current > previous) {
        insights.push({
          key: `refund_impact_${row.currency ?? "unknown"}`,
          title: `Refund Impact (${row.currency ?? "Unknown"})`,
          severity: "warning",
          message: `Refund rate increased versus the comparison period in ${row.currency ?? "Unknown"}. Review previews, instructions, and expectation-setting.`,
        });
      }
    }

    const exchangeRateShift = countMetrics?.weightedAverageExchangeRate && comparisonCountMetrics?.weightedAverageExchangeRate
      ? (countMetrics.weightedAverageExchangeRate - comparisonCountMetrics.weightedAverageExchangeRate)
        / comparisonCountMetrics.weightedAverageExchangeRate
      : null;

    if (exchangeRateShift !== null && Math.abs(exchangeRateShift) > 0.05) {
      insights.push({
        key: "exchange_rate_shift",
        title: "Exchange Rate Shift",
        severity: "neutral",
        message: `Weighted average exchange rate moved by ${(Math.abs(exchangeRateShift) * 100).toFixed(1)}% versus the comparison period.`,
      });
    }

    for (const row of netAmountRows) {
      const current = toNumber(row.amount);
      const previous = findCurrencyAmount(previousNetAmountRows, row.currency);
      if (previous !== null) {
        insights.push({
          key: `net_payout_movement_${row.currency ?? "unknown"}`,
          title: `Net Payout Movement (${row.currency ?? "Unknown"})`,
          severity: current > previous ? "positive" : current < previous ? "warning" : "neutral",
          message: current > previous
            ? "Net payout improved versus the comparison period."
            : current < previous
              ? "Net payout declined versus the comparison period."
              : "Net payout is flat versus the comparison period.",
        });
      }
    }

    if (
      countMetrics?.averagePayoutDelayDays !== null
      && comparisonCountMetrics?.averagePayoutDelayDays !== null
      && countMetrics?.averagePayoutDelayDays !== undefined
      && comparisonCountMetrics?.averagePayoutDelayDays !== undefined
    ) {
      const delta = countMetrics.averagePayoutDelayDays - comparisonCountMetrics.averagePayoutDelayDays;
      if (Math.abs(delta) >= 1) {
        insights.push({
          key: "payout_timing",
          title: "Payout Timing",
          severity: "neutral",
          message: delta > 0
            ? `Average funds-available timing slowed by ${delta.toFixed(1)} days versus the comparison period.`
            : `Average funds-available timing improved by ${Math.abs(delta).toFixed(1)} days versus the comparison period.`,
        });
      }
    }

    return Response.json({
      report: "payments",
      filters: serializeFilters(filters),
      dateRange: {
        from: filters.dateFrom,
        to: filters.dateTo,
      },
      comparison,
      provenance: {
        payments: paymentProvenance,
      },
      kpis,
      charts: {
        grossVsNetTrend: grossVsNetTrendRows,
        effectiveFeeRateOverTime: feeRateTrendRows,
        feesOverTime: feesTrendRows,
        refundTrend: refundTrendRows,
        listingAmountDistribution: listingDistributionRows,
        exchangeRateTrend: exchangeRateTrendRows,
        paymentStatusDistribution: paymentStatusRows,
      },
      insights,
      warnings,
    });
  } catch (error) {
    console.error("payments_summary_failed", error);
    return jsonError(500, "payments_summary_failed");
  }
}

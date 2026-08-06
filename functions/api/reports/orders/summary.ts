import {
  buildPaymentFinancialWhere,
  buildReportWhere,
  parseReportFilters,
  type ParsedReportFilters,
} from "../_filters";
import { collectMixedCurrencyWarning, toNumber } from "../_money";
import { aggregateDiscountRate } from "../_discount";
import {
  assessCurrency,
  buildFinancialQualityWarnings,
  calculateGrossSales,
  countCoveredOrders,
  requirePaymentCoverage,
  summarizePaymentFinancials,
  type PaymentFinancialRow,
} from "../../intelligence/_financials";
import { aggregateProvenance, type DataProvenance } from "../../intelligence/_provenance";
import {
  buildCountKpi,
  buildMoneyKpi,
  buildPercentKpi,
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

type CountMetricRow = {
  totalOrders: number | null;
  averageItemsPerOrder: number | null;
  couponUsageRate: number | null;
};

type CurrencyMetricRow = {
  currency: string | null;
  amount: number | null;
};

type RepeatBuyerRow = {
  repeatBuyerRate: number | null;
  totalBuyers: number | null;
  repeatBuyers: number | null;
};

type MonthlyRow = {
  month: string;
  currency: string | null;
  orderCount: number | null;
  orderValue: number | null;
  averageOrderValue: number | null;
};

type CountryRow = {
  country: string | null;
  currency: string | null;
  orderCount: number | null;
  orderValue: number | null;
};

type CityRow = {
  country: string | null;
  city: string | null;
  currency: string | null;
  orderCount: number | null;
  orderValue: number | null;
};

type CouponSplitRow = {
  segment: string;
  currency: string | null;
  orderCount: number | null;
  orderValue: number | null;
};

type DistributionRow = {
  bucket: string;
  orderCount: number | null;
};

type CouponEffectivenessRow = {
  couponCode: string | null;
  currency: string | null;
  orderCount: number | null;
  orderValue: number | null;
  averageOrderValue: number | null;
  totalDiscount: number | null;
  discountRate: number | null;
};

type DiscountAggregateRow = {
  currency: string | null;
  discountTotal: number | null;
  totalPriceTotal: number | null;
};

type FinancialAggregateRow = {
  listValue: number | null;
  discounts: number | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
  withheldDiscountRows: number | null;
};

const FILTER_COLUMNS = {
  date: "sale_date",
  country: "ship_country",
  city: "ship_city",
  currency: "order_currency",
  couponCode: "coupon_code",
  status: "order_status",
  orderId: "order_id",
  q: ["order_id", "buyer_user_id", "ship_country", "ship_city", "coupon_code", "sku"],
} as const;

function getOrdersWhere(filters: ParsedReportFilters) {
  return buildReportWhere(filters, {
    columns: FILTER_COLUMNS,
  });
}

function getPaymentFinancialWhere(filters: ParsedReportFilters) {
  return buildPaymentFinancialWhere(filters, FILTER_COLUMNS);
}

function appendCondition(whereSql: string, condition: string): string {
  return whereSql ? `${whereSql} AND ${condition}` : `WHERE ${condition}`;
}

function currencyValues(value: string | null | undefined): string[] {
  return value?.split(",").map((currency) => currency.trim()).filter(Boolean) ?? [];
}

function findCurrencyAmount(rows: CurrencyMetricRow[], currency: string | null): number | null {
  const match = rows.find((row) => (row.currency ?? "Unknown") === (currency ?? "Unknown"));
  return match ? toNumber(match.amount) : null;
}

function buildAovInsights(
  currentRows: CurrencyMetricRow[],
  previousRows: CurrencyMetricRow[],
): InsightBlock[] {
  return currentRows.map((row) => {
    const current = toNumber(row.amount);
    const previous = findCurrencyAmount(previousRows, row.currency);
    const deltaPercent = previous && previous !== 0 ? (current - previous) / previous : null;

    if (deltaPercent === null) {
      return {
        key: `aov_movement_${row.currency ?? "unknown"}`,
        title: `AOV Movement (${row.currency ?? "Unknown"})`,
        severity: "neutral",
        message: "Previous-period AOV comparison is unavailable for this currency.",
        metricKeys: [`average_order_value_${row.currency ?? "unknown"}`],
      } satisfies InsightBlock;
    }

    if (deltaPercent > 0.05) {
      return {
        key: `aov_movement_${row.currency ?? "unknown"}`,
        title: `AOV Movement (${row.currency ?? "Unknown"})`,
        severity: "positive",
        message: `Average order value improved by ${(deltaPercent * 100).toFixed(1)}% versus the comparison period.`,
        metricKeys: [`average_order_value_${row.currency ?? "unknown"}`],
      } satisfies InsightBlock;
    }

    if (deltaPercent < -0.05) {
      return {
        key: `aov_movement_${row.currency ?? "unknown"}`,
        title: `AOV Movement (${row.currency ?? "Unknown"})`,
        severity: "warning",
        message: `Average order value declined by ${Math.abs(deltaPercent * 100).toFixed(1)}% versus the comparison period.`,
        metricKeys: [`average_order_value_${row.currency ?? "unknown"}`],
      } satisfies InsightBlock;
    }

    return {
      key: `aov_movement_${row.currency ?? "unknown"}`,
      title: `AOV Movement (${row.currency ?? "Unknown"})`,
      severity: "neutral",
      message: "Average order value is broadly stable versus the comparison period.",
      metricKeys: [`average_order_value_${row.currency ?? "unknown"}`],
    } satisfies InsightBlock;
  });
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
  const { whereSql, bindings } = getOrdersWhere(filters);
  const comparisonWhere = getOrdersWhere(comparisonFilters);
  const paymentFinancialWhere = getPaymentFinancialWhere(filters);

  try {
    const [countMetrics, comparisonCountMetrics] = await Promise.all([
      queryFirst<CountMetricRow>(
        context.env.DB,
        `
          SELECT
            COUNT(DISTINCT order_id) AS totalOrders,
            SUM(number_of_items) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS averageItemsPerOrder,
            COUNT(DISTINCT CASE WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN order_id END) * 1.0
              / NULLIF(COUNT(DISTINCT order_id), 0) AS couponUsageRate
          FROM v_orders_canonical
          ${whereSql}
        `,
        bindings,
      ),
      comparison.mode === "none"
        ? Promise.resolve(null)
        : queryFirst<CountMetricRow>(
          context.env.DB,
          `
            SELECT
              COUNT(DISTINCT order_id) AS totalOrders,
              SUM(number_of_items) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS averageItemsPerOrder,
              COUNT(DISTINCT CASE WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN order_id END) * 1.0
                / NULLIF(COUNT(DISTINCT order_id), 0) AS couponUsageRate
            FROM v_orders_canonical
            ${comparisonWhere.whereSql}
          `,
          comparisonWhere.bindings,
        ),
    ]);

    const [
      grossOrderValueRows,
      previousGrossOrderValueRows,
      averageOrderValueRows,
      previousAverageOrderValueRows,
      discountRateRows,
      previousDiscountRateRows,
      repeatBuyerMetric,
      previousRepeatBuyerMetric,
      monthlyRows,
      topCountryRows,
      topCityRows,
      couponSplitRows,
      itemDistributionRows,
      currencySplitRows,
      couponEffectivenessRows,
      financialAggregate,
      paymentFinancialRows,
      selectedOrderIdRows,
      orderProvenanceRows,
      paymentProvenanceRows,
    ] = await Promise.all([
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT order_currency AS currency, SUM(order_value) AS amount
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY order_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT order_currency AS currency, SUM(order_value) AS amount
          FROM v_orders_canonical
          ${comparisonWhere.whereSql}
          GROUP BY order_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT
            order_currency AS currency,
            SUM(order_value) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS amount
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY order_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT
            order_currency AS currency,
            SUM(order_value) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS amount
          FROM v_orders_canonical
          ${comparisonWhere.whereSql}
          GROUP BY order_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<DiscountAggregateRow>(
        context.env.DB,
        `
          SELECT
            order_currency AS currency,
            SUM(COALESCE(discount_amount, 0)) AS discountTotal,
            SUM(order_value) AS totalPriceTotal
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY order_currency
          ORDER BY totalPriceTotal DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<DiscountAggregateRow>(
        context.env.DB,
        `
          SELECT
            order_currency AS currency,
            SUM(COALESCE(discount_amount, 0)) AS discountTotal,
            SUM(order_value) AS totalPriceTotal
          FROM v_orders_canonical
          ${comparisonWhere.whereSql}
          GROUP BY order_currency
          ORDER BY totalPriceTotal DESC
        `,
        comparisonWhere.bindings,
      ),
      comparison.mode === "none" ? Promise.resolve(null) : queryFirst<RepeatBuyerRow>(
        context.env.DB,
        `
          WITH buyer_counts AS (
            SELECT buyer_user_id, COUNT(DISTINCT order_id) AS orderCount
            FROM v_orders_canonical
            ${appendCondition(whereSql, "buyer_user_id IS NOT NULL AND TRIM(buyer_user_id) <> ''")}
            GROUP BY buyer_user_id
          )
          SELECT
            COUNT(CASE WHEN orderCount > 1 THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) AS repeatBuyerRate,
            COUNT(*) AS totalBuyers,
            COUNT(CASE WHEN orderCount > 1 THEN 1 END) AS repeatBuyers
          FROM buyer_counts
        `,
        bindings,
      ),
      queryFirst<RepeatBuyerRow>(
        context.env.DB,
        `
          WITH buyer_counts AS (
            SELECT buyer_user_id, COUNT(DISTINCT order_id) AS orderCount
            FROM v_orders_canonical
            ${appendCondition(comparisonWhere.whereSql, "buyer_user_id IS NOT NULL AND TRIM(buyer_user_id) <> ''")}
            GROUP BY buyer_user_id
          )
          SELECT
            COUNT(CASE WHEN orderCount > 1 THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0) AS repeatBuyerRate,
            COUNT(*) AS totalBuyers,
            COUNT(CASE WHEN orderCount > 1 THEN 1 END) AS repeatBuyers
          FROM buyer_counts
        `,
        comparisonWhere.bindings,
      ),
      queryAll<MonthlyRow>(
        context.env.DB,
        `
          SELECT
            substr(sale_date, 1, 7) AS month,
            order_currency AS currency,
            COUNT(DISTINCT order_id) AS orderCount,
            SUM(order_value) AS orderValue,
            SUM(order_value) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS averageOrderValue
          FROM v_orders_canonical
          ${appendCondition(whereSql, "sale_date IS NOT NULL")}
          GROUP BY month, order_currency
          ORDER BY month ASC, order_currency ASC
        `,
        bindings,
      ),
      queryAll<CountryRow>(
        context.env.DB,
        `
          SELECT
            ship_country AS country,
            order_currency AS currency,
            COUNT(DISTINCT order_id) AS orderCount,
            SUM(order_value) AS orderValue
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY ship_country, order_currency
          ORDER BY orderCount DESC, orderValue DESC
          LIMIT 10
        `,
        bindings,
      ),
      queryAll<CityRow>(
        context.env.DB,
        `
          SELECT
            ship_country AS country,
            ship_city AS city,
            order_currency AS currency,
            COUNT(DISTINCT order_id) AS orderCount,
            SUM(order_value) AS orderValue
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY ship_country, ship_city, order_currency
          ORDER BY orderCount DESC, orderValue DESC
          LIMIT 20
        `,
        bindings,
      ),
      queryAll<CouponSplitRow>(
        context.env.DB,
        `
          SELECT
            CASE
              WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN 'coupon'
              ELSE 'no_coupon'
            END AS segment,
            order_currency AS currency,
            COUNT(DISTINCT order_id) AS orderCount,
            SUM(order_value) AS orderValue
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY segment, order_currency
          ORDER BY segment ASC, order_currency ASC
        `,
        bindings,
      ),
      queryAll<DistributionRow>(
        context.env.DB,
        `
          SELECT
            CASE
              WHEN number_of_items <= 1 THEN '1 item'
              WHEN number_of_items = 2 THEN '2 items'
              ELSE '3+ items'
            END AS bucket,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY bucket
          ORDER BY
            CASE bucket
              WHEN '1 item' THEN 1
              WHEN '2 items' THEN 2
              ELSE 3
            END ASC
        `,
        bindings,
      ),
      queryAll<CountryRow>(
        context.env.DB,
        `
          SELECT
            order_currency AS currency,
            COUNT(DISTINCT order_id) AS orderCount,
            SUM(order_value) AS orderValue,
            NULL AS country
          FROM v_orders_canonical
          ${whereSql}
          GROUP BY order_currency
          ORDER BY orderCount DESC, orderValue DESC
        `,
        bindings,
      ),
      queryAll<CouponEffectivenessRow>(
        context.env.DB,
        `
          SELECT
            coupon_code AS couponCode,
            order_currency AS currency,
            COUNT(DISTINCT order_id) AS orderCount,
            SUM(order_value) AS orderValue,
            AVG(order_value) AS averageOrderValue,
            SUM(discount_amount) AS totalDiscount
          FROM v_orders_canonical
          ${appendCondition(whereSql, "coupon_code IS NOT NULL AND TRIM(coupon_code) <> ''")}
          GROUP BY coupon_code, order_currency
          HAVING COUNT(DISTINCT order_id) >= 3
          ORDER BY orderValue DESC, orderCount DESC
          LIMIT 15
        `,
        bindings,
      ),
      queryFirst<FinancialAggregateRow>(
        context.env.DB,
        `
          SELECT
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
          ${whereSql}
        `,
        bindings,
      ),
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
          ${paymentFinancialWhere.whereSql}
        `,
        paymentFinancialWhere.bindings,
      ),
      queryAll<{ orderId: string }>(
        context.env.DB,
        `
          SELECT DISTINCT order_id AS orderId
          FROM v_orders_canonical
          ${whereSql}
        `,
        bindings,
      ),
      queryAll<{ dataSource: string | null }>(
        context.env.DB,
        `
          SELECT DISTINCT data_source AS dataSource
          FROM v_orders_canonical
          ${whereSql}
        `,
        bindings,
      ),
      queryAll<{ dataSource: string | null }>(
        context.env.DB,
        `
          SELECT DISTINCT data_source AS dataSource
          FROM v_payments_canonical
          ${paymentFinancialWhere.whereSql}
        `,
        paymentFinancialWhere.bindings,
      ),
    ]);

    const orderProvenance: DataProvenance | null = aggregateProvenance(
      orderProvenanceRows.map((row) => row.dataSource),
    );
    const paymentProvenance: DataProvenance | null = aggregateProvenance(
      paymentProvenanceRows.map((row) => row.dataSource),
    );
    const couponEffectiveness = couponEffectivenessRows.map((row) => ({
      ...row,
      discountRate: aggregateDiscountRate(row.totalDiscount, row.orderValue),
    }));
    const previousDiscountRates = previousDiscountRateRows.map((row) => ({
      currency: row.currency,
      amount: aggregateDiscountRate(row.discountTotal, row.totalPriceTotal),
    }));

    const warnings: string[] = [];
    const mixedWarning = collectMixedCurrencyWarning(grossOrderValueRows, "Orders summary");
    if (mixedWarning) {
      warnings.push(mixedWarning);
    }

    warnings.push("Repeat buyer rate is username-based and should be treated as an estimate.");

    const totalOrders = toNumber(countMetrics?.totalOrders);
    const orderCurrencyQuality = assessCurrency(
      currencyValues(financialAggregate?.currencies),
      toNumber(financialAggregate?.missingCurrencyRows),
      "USD",
    );
    const withheldDiscountRows = toNumber(financialAggregate?.withheldDiscountRows);
    const selectedOrderIds = new Set(
      selectedOrderIdRows.map((row) => row.orderId).filter(Boolean),
    );
    const paymentFinancials = requirePaymentCoverage(
      summarizePaymentFinancials(paymentFinancialRows),
      totalOrders,
      countCoveredOrders(paymentFinancialRows, selectedOrderIds),
    );

    warnings.push(
      ...buildFinancialQualityWarnings([
        {
          label: "selected",
          orders: totalOrders,
          orderCurrency: orderCurrencyQuality,
          discountWithheldRows: withheldDiscountRows,
          payments: paymentFinancials,
        },
      ]),
    );

    const kpis: KpiCard[] = [
      buildCountKpi(
        "total_orders",
        "Total Orders",
        toNumber(countMetrics?.totalOrders),
        comparison.mode === "none" ? null : toNumber(comparisonCountMetrics?.totalOrders),
      ),
    ];

    for (const row of grossOrderValueRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `gross_order_value_${currencyKey}`,
          `List Value (${row.currency ?? "Unknown"})`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousGrossOrderValueRows, row.currency),
        ),
      );
    }

    for (const row of averageOrderValueRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `average_order_value_${currencyKey}`,
          `Average Order Value (${row.currency ?? "Unknown"})`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousAverageOrderValueRows, row.currency),
        ),
      );
    }

    kpis.push(
      buildCountKpi(
        "average_items_per_order",
        "Average Items per Order",
        countMetrics?.averageItemsPerOrder ?? null,
        comparison.mode === "none" ? null : comparisonCountMetrics?.averageItemsPerOrder ?? null,
      ),
      buildPercentKpi(
        "coupon_usage_rate",
        "Coupon Usage Rate",
        countMetrics?.couponUsageRate ?? null,
        comparison.mode === "none" ? null : comparisonCountMetrics?.couponUsageRate ?? null,
      ),
    );

    for (const row of discountRateRows) {
      const currencyKey = row.currency ?? "unknown";
      const amount = aggregateDiscountRate(row.discountTotal, row.totalPriceTotal);
      kpis.push(
        buildPercentKpi(
          `effective_discount_rate_${currencyKey}`,
          `Effective Discount Rate (${row.currency ?? "Unknown"})`,
          amount,
          comparison.mode === "none" ? null : findCurrencyAmount(previousDiscountRates, row.currency),
        ),
      );
    }

    kpis.push(
      buildPercentKpi(
        "estimated_repeat_buyer_rate",
        "Estimated Repeat Buyer Rate",
        repeatBuyerMetric?.repeatBuyerRate ?? null,
        comparison.mode === "none" ? null : previousRepeatBuyerMetric?.repeatBuyerRate ?? null,
        "Buyer identity is incomplete in Etsy exports, so treat this as directional.",
      ),
    );

    // Financial KPIs (USD-converted). Both stay null (KPI omitted) rather than
    // falling back to 0 when currency quality or payment coverage is bad —
    // a bad $0 reads as "no sales," which is worse than not showing the card.
    const netUsd = paymentFinancials.netRevenueUsd;
    const revenueAfterDiscount =
      orderCurrencyQuality.valid && withheldDiscountRows === 0
        ? calculateGrossSales(financialAggregate?.listValue, financialAggregate?.discounts)
        : null;

    if (revenueAfterDiscount !== null && revenueAfterDiscount > 0) {
      kpis.push(
        buildMoneyKpi(
          "revenue_after_discount_usd",
          "Gross Sales (USD)",
          revenueAfterDiscount,
          "USD",
          null,
        ),
      );
    }

    if (netUsd !== null && netUsd > 0) {
      kpis.push(
        buildMoneyKpi(
          "net_usd_revenue",
          "Net Revenue (USD)",
          netUsd,
          "USD",
          null,
        ),
      );
    }

    if (revenueAfterDiscount !== null && revenueAfterDiscount > 0 && netUsd !== null && netUsd > 0) {
      const marginRate = netUsd / revenueAfterDiscount;
      kpis.push(
        buildPercentKpi(
          // Not profit: this margin is Gross Sales vs Net Revenue, and Net
          // Revenue is after the Etsy payment processing fee only. Advertising,
          // the transaction commission, listing renewals and VAT are not in it —
          // they live in the Etsy ledger and cannot be split by this report's
          // country/coupon/listing filters. The dashboard's True Net can.
          "payment_margin_rate",
          "Margin Rate (after payment fees)",
          marginRate,
          null,
        ),
      );
    }

    const insights: InsightBlock[] = [
      ...buildAovInsights(averageOrderValueRows, previousAverageOrderValueRows),
      {
        key: "coupon_dependency",
        title: "Coupon Dependency",
        severity: (countMetrics?.couponUsageRate ?? 0) >= 0.5
          ? "warning"
          : (countMetrics?.couponUsageRate ?? 0) >= 0.25
            ? "opportunity"
            : "neutral",
        message: (countMetrics?.couponUsageRate ?? 0) >= 0.5
          ? "A high share of orders use coupons. Review whether discounts are becoming necessary to convert sales."
          : (countMetrics?.couponUsageRate ?? 0) >= 0.25
            ? "Coupons contribute meaningfully to orders. Review discount depth and coupon quality, not only usage volume."
            : "Coupon dependence looks limited in the selected period.",
        metricKeys: ["coupon_usage_rate"],
      },
      {
        key: "multi_item_opportunity",
        title: "Multi-Item Opportunity",
        severity: (countMetrics?.averageItemsPerOrder ?? 0) < 1.25 ? "opportunity" : "neutral",
        message: (countMetrics?.averageItemsPerOrder ?? 0) < 1.25
          ? "Most orders are near one item. Bundles or multi-item coupon offers may lift average basket size."
          : "Order baskets show more than one item often enough that bundling is less urgent.",
        metricKeys: ["average_items_per_order"],
        action: (countMetrics?.averageItemsPerOrder ?? 0) < 1.25
          ? "Test bundles, related-product sets, or multi-item discount prompts."
          : undefined,
      },
      {
        key: "repeat_buyer_signal",
        title: "Repeat Buyer Signal",
        severity: repeatBuyerMetric?.repeatBuyerRate == null
          ? "neutral"
          : (repeatBuyerMetric.repeatBuyerRate ?? 0) < 0.1
            ? "opportunity"
            : (repeatBuyerMetric.repeatBuyerRate ?? 0) >= 0.2
              ? "positive"
              : "neutral",
        message: repeatBuyerMetric?.repeatBuyerRate == null
          ? "Repeat buyer rate cannot be measured cleanly from the available buyer identity fields."
          : (repeatBuyerMetric.repeatBuyerRate ?? 0) < 0.1
            ? "Repeat purchase activity looks weak. Consider post-purchase coupons or curated follow-up collections."
            : (repeatBuyerMetric.repeatBuyerRate ?? 0) >= 0.2
              ? "Repeat purchase behavior is visible in the selected period."
              : "Some repeat buyer activity is visible, but it is not yet strong.",
        metricKeys: ["estimated_repeat_buyer_rate"],
      },
      {
        key: "strongest_country",
        title: "Strongest Country",
        severity: "positive",
        message: topCountryRows[0]?.country
          ? `${topCountryRows[0].country} leads by order count with ${toNumber(topCountryRows[0].orderCount)} orders.`
          : "No country leader is available for the selected filters.",
      },
      {
        key: "strongest_city",
        title: "Strongest City",
        severity: "positive",
        message: topCityRows[0]?.city
          ? `${topCityRows[0].city}, ${topCityRows[0].country ?? "Unknown"} leads by order count with ${toNumber(topCityRows[0].orderCount)} orders.`
          : "No city leader is available for the selected filters.",
      },
    ];

    return Response.json({
      report: "orders",
      filters: serializeFilters(filters),
      dateRange: {
        from: filters.dateFrom,
        to: filters.dateTo,
      },
      comparison,
      provenance: {
        orders: orderProvenance,
        payments: paymentProvenance,
      },
      kpis,
      charts: {
        monthlyOrdersRevenue: monthlyRows,
        topCountries: topCountryRows,
        topCities: topCityRows,
        couponVsNoCoupon: couponSplitRows,
        itemsPerOrderDistribution: itemDistributionRows,
        currencySplit: currencySplitRows,
        couponEffectiveness,
      },
      insights,
      warnings,
    });
  } catch (error) {
    console.error("orders_summary_failed", error);
    return jsonError(500, "orders_summary_failed");
  }
}

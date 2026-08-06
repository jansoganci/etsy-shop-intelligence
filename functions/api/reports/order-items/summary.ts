import { buildReportWhere, parseReportFilters, type ParsedReportFilters } from "../_filters";
import { collectMixedCurrencyWarning, toNumber } from "../_money";
import { assessCurrency, calculateGrossSales } from "../../intelligence/_financials";
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
  unitsSold: number | null;
  uniqueOrders: number | null;
  couponUsageRate: number | null;
  averageUnitsPerOrder: number | null;
};

type CurrencyMetricRow = {
  currency: string | null;
  amount: number | null;
};

type ListingRow = {
  listingId: string | null;
  listingTitle: string | null;
  currency: string | null;
  revenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type MarketRow = {
  country: string | null;
  currency: string | null;
  revenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type MonthlyRow = {
  month: string;
  currency: string | null;
  revenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type CityRow = {
  country: string | null;
  city: string | null;
  currency: string | null;
  revenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type CouponListingRow = {
  couponCode: string | null;
  listingId: string | null;
  listingTitle: string | null;
  currency: string | null;
  revenue: number | null;
  unitsSold: number | null;
  discountAmount: number | null;
  orderCount: number | null;
};

type WeakListingRow = {
  listingId: string | null;
  listingTitle: string | null;
  currency: string | null;
  historicalRevenue: number | null;
  lastSaleDate: string | null;
};

type ConcentrationRow = {
  currency: string | null;
  totalRevenue: number | null;
  top3Revenue: number | null;
  top5Revenue: number | null;
};

type WinnerRow = {
  listingId: string | null;
  listingTitle: string | null;
  monthCount: number | null;
  revenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type GeographicFitRow = {
  listingId: string | null;
  listingTitle: string | null;
  country: string | null;
  countryRevenueShare: number | null;
  listingRevenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type CouponDependenceRow = {
  listingId: string | null;
  listingTitle: string | null;
  couponShare: number | null;
  revenue: number | null;
  unitsSold: number | null;
  orderCount: number | null;
};

type BoundsRow = {
  minDate: string | null;
  maxDate: string | null;
};

type GrossSalesAggregateRow = {
  listValue: number | null;
  discounts: number | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
};

const FILTER_COLUMNS = {
  date: "sale_date",
  country: "ship_country",
  city: "ship_city",
  currency: "item_currency",
  couponCode: "coupon_code",
  orderId: "order_id",
  listingId: "listing_id",
  q: ["listing_title", "listing_id", "sku", "order_id", "transaction_id", "ship_country", "ship_city"],
} as const;

const MIN_INSIGHT_ORDER_COUNT = 3;
const MIN_INSIGHT_UNITS_SOLD = 3;
const MIN_INSIGHT_REVENUE = 15;

function getItemsWhere(filters: ParsedReportFilters) {
  return buildReportWhere(filters, {
    columns: FILTER_COLUMNS,
  });
}

function findCurrencyAmount(rows: CurrencyMetricRow[], currency: string | null): number | null {
  const match = rows.find((row) => (row.currency ?? "Unknown") === (currency ?? "Unknown"));
  return match ? toNumber(match.amount) : null;
}

function appendCondition(whereSql: string, condition: string): string {
  return whereSql ? `${whereSql} AND ${condition}` : `WHERE ${condition}`;
}

function currencyValues(value: string | null | undefined): string[] {
  return value?.split(",").map((currency) => currency.trim()).filter(Boolean) ?? [];
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function hasMeaningfulInsightSample(row: {
  orderCount?: number | null;
  unitsSold?: number | null;
  revenue?: number | null;
  listingRevenue?: number | null;
}): boolean {
  return (
    toNumber(row.orderCount) >= MIN_INSIGHT_ORDER_COUNT
    || toNumber(row.unitsSold) >= MIN_INSIGHT_UNITS_SOLD
    || toNumber(row.revenue ?? row.listingRevenue) >= MIN_INSIGHT_REVENUE
  );
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
  const { whereSql, bindings } = getItemsWhere(filters);
  const comparisonWhere = getItemsWhere(comparisonFilters);

  try {
    const bounds = await queryFirst<BoundsRow>(
      context.env.DB,
      `
        SELECT
          MIN(sale_date) AS minDate,
          MAX(sale_date) AS maxDate
        FROM v_order_items_canonical
        ${appendCondition(whereSql, "sale_date IS NOT NULL")}
      `,
      bindings,
    );

    const selectedEndDate = filters.dateTo ?? bounds?.maxDate;
    const recentStartDate = selectedEndDate ? shiftDate(selectedEndDate, -89) : null;

    const [
      countMetrics,
      comparisonCountMetrics,
      totalRevenueRows,
      previousRevenueRows,
      averageItemValueRows,
      previousAverageItemValueRows,
      topListingRows,
      topMarketRows,
      monthlyRows,
      topListings,
      concentrationRows,
      weakListings,
      countryRankingRows,
      cityRankingRows,
      couponPerformanceRows,
      repeatableWinners,
      geographicFitRows,
      couponDependenceRows,
      grossSalesAggregate,
    ] = await Promise.all([
      queryFirst<CountMetricRow>(
        context.env.DB,
        `
          SELECT
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS uniqueOrders,
            COUNT(CASE WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN 1 END) * 1.0
              / NULLIF(COUNT(*), 0) AS couponUsageRate,
            SUM(quantity) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS averageUnitsPerOrder
          FROM v_order_items_canonical
          ${whereSql}
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve(null) : queryFirst<CountMetricRow>(
        context.env.DB,
        `
          SELECT
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS uniqueOrders,
            COUNT(CASE WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN 1 END) * 1.0
              / NULLIF(COUNT(*), 0) AS couponUsageRate,
            SUM(quantity) * 1.0 / NULLIF(COUNT(DISTINCT order_id), 0) AS averageUnitsPerOrder
          FROM v_order_items_canonical
          ${comparisonWhere.whereSql}
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT item_currency AS currency, SUM(item_total) AS amount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY item_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT item_currency AS currency, SUM(item_total) AS amount
          FROM v_order_items_canonical
          ${comparisonWhere.whereSql}
          GROUP BY item_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT item_currency AS currency, SUM(item_total) * 1.0 / NULLIF(SUM(quantity), 0) AS amount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY item_currency
          ORDER BY amount DESC
        `,
        bindings,
      ),
      comparison.mode === "none" ? Promise.resolve([]) : queryAll<CurrencyMetricRow>(
        context.env.DB,
        `
          SELECT item_currency AS currency, SUM(item_total) * 1.0 / NULLIF(SUM(quantity), 0) AS amount
          FROM v_order_items_canonical
          ${comparisonWhere.whereSql}
          GROUP BY item_currency
          ORDER BY amount DESC
        `,
        comparisonWhere.bindings,
      ),
      queryAll<ListingRow>(
        context.env.DB,
        `
          SELECT
            listing_id AS listingId,
            listing_title AS listingTitle,
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY listing_id, listing_title, item_currency
          ORDER BY revenue DESC
          LIMIT 1
        `,
        bindings,
      ),
      queryAll<MarketRow>(
        context.env.DB,
        `
          SELECT
            ship_country AS country,
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY ship_country, item_currency
          ORDER BY revenue DESC
          LIMIT 1
        `,
        bindings,
      ),
      queryAll<MonthlyRow>(
        context.env.DB,
        `
          SELECT
            substr(sale_date, 1, 7) AS month,
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${appendCondition(whereSql, "sale_date IS NOT NULL")}
          GROUP BY month, item_currency
          ORDER BY month ASC, item_currency ASC
        `,
        bindings,
      ),
      queryAll<ListingRow>(
        context.env.DB,
        `
          SELECT
            listing_id AS listingId,
            listing_title AS listingTitle,
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY listing_id, listing_title, item_currency
          ORDER BY revenue DESC
          LIMIT 10
        `,
        bindings,
      ),
      queryAll<ConcentrationRow>(
        context.env.DB,
        `
          WITH listing_totals AS (
            SELECT
              item_currency AS currency,
              listing_id,
              SUM(item_total - COALESCE(discount_amount, 0)) AS revenue
            FROM v_order_items_canonical
            ${whereSql}
            GROUP BY item_currency, listing_id
          ),
          ranked AS (
            SELECT
              currency,
              revenue,
              ROW_NUMBER() OVER (PARTITION BY currency ORDER BY revenue DESC) AS rankInCurrency
            FROM listing_totals
          )
          SELECT
            currency,
            SUM(revenue) AS totalRevenue,
            SUM(CASE WHEN rankInCurrency <= 3 THEN revenue ELSE 0 END) AS top3Revenue,
            SUM(CASE WHEN rankInCurrency <= 5 THEN revenue ELSE 0 END) AS top5Revenue
          FROM ranked
          GROUP BY currency
        `,
        bindings,
      ),
      recentStartDate
        ? queryAll<WeakListingRow>(
          context.env.DB,
          `
            WITH filtered AS (
              SELECT *
              FROM v_order_items_canonical
              ${whereSql}
            )
            SELECT
              listing_id AS listingId,
              listing_title AS listingTitle,
              item_currency AS currency,
              SUM(CASE WHEN sale_date < ? THEN item_total - COALESCE(discount_amount, 0) ELSE 0 END) AS historicalRevenue,
              MAX(sale_date) AS lastSaleDate
            FROM filtered
            GROUP BY listing_id, listing_title, item_currency
            HAVING SUM(CASE WHEN sale_date < ? THEN 1 ELSE 0 END) > 0
               AND SUM(CASE WHEN sale_date >= ? THEN 1 ELSE 0 END) = 0
            ORDER BY historicalRevenue DESC
            LIMIT 10
          `,
          [...bindings, recentStartDate, recentStartDate, recentStartDate],
        )
        : Promise.resolve([]),
      queryAll<MarketRow>(
        context.env.DB,
        `
          SELECT
            ship_country AS country,
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY ship_country, item_currency
          ORDER BY revenue DESC
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
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY ship_country, ship_city, item_currency
          ORDER BY revenue DESC
          LIMIT 20
        `,
        bindings,
      ),
      queryAll<CouponListingRow>(
        context.env.DB,
        `
          SELECT
            coupon_code AS couponCode,
            listing_id AS listingId,
            listing_title AS listingTitle,
            item_currency AS currency,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            SUM(discount_amount) AS discountAmount,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${appendCondition(whereSql, "coupon_code IS NOT NULL AND TRIM(coupon_code) <> ''")}
          GROUP BY coupon_code, listing_id, listing_title, item_currency
          ORDER BY revenue DESC, orderCount DESC
          LIMIT 10
        `,
        bindings,
      ),
      queryAll<WinnerRow>(
        context.env.DB,
        `
          WITH monthly_listing_revenue AS (
            SELECT
              substr(sale_date, 1, 7) AS month,
              listing_id,
              listing_title,
              item_currency,
              SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
              SUM(quantity) AS unitsSold,
              COUNT(DISTINCT order_id) AS orderCount,
              ROW_NUMBER() OVER (
                PARTITION BY substr(sale_date, 1, 7), item_currency
                ORDER BY SUM(item_total - COALESCE(discount_amount, 0)) DESC
              ) AS rankInMonth
            FROM v_order_items_canonical
            ${appendCondition(whereSql, "sale_date IS NOT NULL")}
            GROUP BY month, listing_id, listing_title, item_currency
          )
          SELECT
            listing_id AS listingId,
            listing_title AS listingTitle,
            COUNT(*) AS monthCount,
            SUM(revenue) AS revenue,
            SUM(unitsSold) AS unitsSold,
            SUM(orderCount) AS orderCount
          FROM monthly_listing_revenue
          WHERE rankInMonth <= 5
          GROUP BY listing_id, listing_title
          HAVING COUNT(*) >= 2
          ORDER BY monthCount DESC, revenue DESC
          LIMIT 10
        `,
        bindings,
      ),
      queryAll<GeographicFitRow>(
        context.env.DB,
        `
          WITH listing_country AS (
            SELECT
              listing_id,
              listing_title,
              ship_country,
              SUM(item_total - COALESCE(discount_amount, 0)) AS countryRevenue
            FROM v_order_items_canonical
            ${whereSql}
            GROUP BY listing_id, listing_title, ship_country
          ),
          listing_totals AS (
            SELECT
              listing_id,
              SUM(item_total - COALESCE(discount_amount, 0)) AS listingRevenue,
              SUM(quantity) AS unitsSold,
              COUNT(DISTINCT order_id) AS orderCount
            FROM v_order_items_canonical
            ${whereSql}
            GROUP BY listing_id
          )
          SELECT
            lc.listing_id AS listingId,
            lc.listing_title AS listingTitle,
            lc.ship_country AS country,
            lc.countryRevenue * 1.0 / NULLIF(lt.listingRevenue, 0) AS countryRevenueShare,
            lt.listingRevenue AS listingRevenue,
            lt.unitsSold AS unitsSold,
            lt.orderCount AS orderCount
          FROM listing_country lc
          JOIN listing_totals lt ON lt.listing_id = lc.listing_id
          WHERE lt.listingRevenue > 0
            AND lc.countryRevenue * 1.0 / NULLIF(lt.listingRevenue, 0) >= 0.40
          ORDER BY countryRevenueShare DESC, listingRevenue DESC
          LIMIT 10
        `,
        [...bindings, ...bindings],
      ),
      queryAll<CouponDependenceRow>(
        context.env.DB,
        `
          SELECT
            listing_id AS listingId,
            listing_title AS listingTitle,
            COUNT(CASE WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN 1 END) * 1.0
              / NULLIF(COUNT(*), 0) AS couponShare,
            SUM(item_total - COALESCE(discount_amount, 0)) AS revenue,
            SUM(quantity) AS unitsSold,
            COUNT(DISTINCT order_id) AS orderCount
          FROM v_order_items_canonical
          ${whereSql}
          GROUP BY listing_id, listing_title
          HAVING COUNT(CASE WHEN coupon_code IS NOT NULL AND TRIM(coupon_code) <> '' THEN 1 END) * 1.0
            / NULLIF(COUNT(*), 0) >= 0.50
          ORDER BY couponShare DESC, revenue DESC, orderCount DESC
          LIMIT 10
        `,
        bindings,
      ),
      queryFirst<GrossSalesAggregateRow>(
        context.env.DB,
        `
          SELECT
            SUM(item_total) AS listValue,
            SUM(COALESCE(discount_amount, 0)) AS discounts,
            GROUP_CONCAT(DISTINCT item_currency) AS currencies,
            SUM(CASE WHEN item_currency IS NULL OR TRIM(item_currency) = '' THEN 1 ELSE 0 END)
              AS missingCurrencyRows
          FROM v_order_items_canonical
          ${whereSql}
        `,
        bindings,
      ),
    ]);

    const warnings: string[] = [];
    const mixedWarning = collectMixedCurrencyWarning(totalRevenueRows, "Order items summary");
    if (mixedWarning) {
      warnings.push(mixedWarning);
    }

    const listingCurrencyQuality = assessCurrency(
      currencyValues(grossSalesAggregate?.currencies),
      toNumber(grossSalesAggregate?.missingCurrencyRows),
      "USD",
    );
    if (!listingCurrencyQuality.valid) {
      warnings.push(
        "Listing Gross Sales (USD) is unavailable because item currency is mixed, missing, or not USD.",
      );
    }

    const kpis: KpiCard[] = [];

    for (const row of totalRevenueRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `total_item_revenue_${currencyKey}`,
          `List Value (${row.currency ?? "Unknown"})`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousRevenueRows, row.currency),
        ),
      );
    }

    if (listingCurrencyQuality.valid) {
      const listingGrossSales = calculateGrossSales(
        grossSalesAggregate?.listValue,
        grossSalesAggregate?.discounts,
      );
      if (listingGrossSales > 0) {
        kpis.push(
          buildMoneyKpi(
            "listing_gross_sales_usd",
            "Listing Gross Sales (USD)",
            listingGrossSales,
            "USD",
            null,
          ),
        );
      }
    }

    kpis.push(
      buildCountKpi(
        "units_sold",
        "Units Sold",
        toNumber(countMetrics?.unitsSold),
        comparison.mode === "none" ? null : toNumber(comparisonCountMetrics?.unitsSold),
      ),
      buildCountKpi(
        "unique_orders",
        "Unique Orders",
        toNumber(countMetrics?.uniqueOrders),
        comparison.mode === "none" ? null : toNumber(comparisonCountMetrics?.uniqueOrders),
      ),
    );

    for (const row of averageItemValueRows) {
      const currencyKey = row.currency ?? "unknown";
      kpis.push(
        buildMoneyKpi(
          `average_item_value_${currencyKey}`,
          `Average Item Value (${row.currency ?? "Unknown"})`,
          toNumber(row.amount),
          row.currency,
          comparison.mode === "none" ? null : findCurrencyAmount(previousAverageItemValueRows, row.currency),
        ),
      );
    }

    const topListing = topListingRows[0] ?? null;
    const topMarket = topMarketRows[0] ?? null;

    kpis.push(
      {
        key: "top_listing",
        label: "Top Listing",
        value: topListing?.listingId ?? topListing?.listingTitle ?? null,
        formattedValue: topListing
          ? `${topListing.listingTitle ?? topListing.listingId ?? "Unknown"} (${topListing.currency ?? "Unknown"} ${toNumber(topListing.revenue).toFixed(2)})`
          : "N/A",
        unit: null,
      },
      {
        key: "top_market",
        label: "Top Market",
        value: topMarket?.country ?? null,
        formattedValue: topMarket
          ? `${topMarket.country ?? "Unknown"} (${topMarket.currency ?? "Unknown"} ${toNumber(topMarket.revenue).toFixed(2)})`
          : "N/A",
        unit: null,
      },
      buildPercentKpi(
        "coupon_usage_rate",
        "Coupon Usage Rate",
        countMetrics?.couponUsageRate ?? null,
        comparison.mode === "none" ? null : comparisonCountMetrics?.couponUsageRate ?? null,
        "Calculated as item rows with a coupon code divided by total item rows.",
      ),
    );

    const insights: InsightBlock[] = [];

    if (repeatableWinners[0]) {
      const repeatableWinner = repeatableWinners.find((row) => hasMeaningfulInsightSample(row));
      if (repeatableWinner) {
        insights.push({
          key: "repeatable_winners",
          title: "Repeatable Winners",
          severity: "positive",
          message: `${repeatableWinner.listingTitle ?? repeatableWinner.listingId ?? "A listing"} appeared among top monthly performers in at least two months.`,
        });
      }
    }

    if (weakListings[0]) {
      insights.push({
        key: "weak_product",
        title: "Needs Review",
        severity: "warning",
        message: `This listing sold historically but has no sales in the recent 90-day sub-period.`,
        action: "Review thumbnail, SEO, title, pricing, or bundling for this listing.",
      });
    }

    insights.push({
      key: "bundle_opportunity",
      title: "Bundle Opportunity",
      severity: (countMetrics?.averageUnitsPerOrder ?? 0) < 1.25 ? "opportunity" : "neutral",
      message: (countMetrics?.averageUnitsPerOrder ?? 0) < 1.25
        ? "Average units per order are close to 1. Bundles and cross-sells are worth testing."
        : "Average units per order suggest bundling pressure is less urgent.",
      metricKeys: ["unique_orders", "units_sold"],
    });

    for (const row of concentrationRows) {
      const totalRevenue = toNumber(row.totalRevenue);
      const top3Share = totalRevenue > 0 ? toNumber(row.top3Revenue) / totalRevenue : 0;
      if (top3Share >= 0.5) {
        insights.push({
          key: `revenue_concentration_${row.currency ?? "unknown"}`,
          title: `Revenue Concentration (${row.currency ?? "Unknown"})`,
          severity: "opportunity",
          message: `Top 3 listings contribute ${(top3Share * 100).toFixed(1)}% of item revenue in this currency.`,
          action: "Reduce dependency by building adjacent products around current winners.",
        });
      }
    }

    const geographicFit = geographicFitRows.find((row) => hasMeaningfulInsightSample(row));
    if (geographicFit) {
      insights.push({
        key: "geographic_product_fit",
        title: "Geographic Product Fit",
        severity: "positive",
        message: `${geographicFit.listingTitle ?? geographicFit.listingId ?? "A listing"} gets ${(toNumber(geographicFit.countryRevenueShare) * 100).toFixed(1)}% of its revenue from ${geographicFit.country ?? "one market"}.`,
      });
    }

    const couponDependence = couponDependenceRows.find((row) => hasMeaningfulInsightSample(row));
    if (couponDependence) {
      insights.push({
        key: "coupon_dependence_by_product",
        title: "Coupon Dependence by Product",
        severity: "warning",
        message: `${couponDependence.listingTitle ?? couponDependence.listingId ?? "A listing"} sells with coupons on ${(toNumber(couponDependence.couponShare) * 100).toFixed(1)}% of item rows.`,
      });
    }

    return Response.json({
      report: "order_items",
      filters: serializeFilters(filters),
      dateRange: {
        from: filters.dateFrom,
        to: filters.dateTo,
      },
      comparison,
      kpis,
      charts: {
        monthlyItemRevenueUnitsSold: monthlyRows,
        topListings,
        revenueConcentration: concentrationRows.map((row) => ({
          currency: row.currency,
          totalRevenue: row.totalRevenue,
          top3Revenue: row.top3Revenue,
          top5Revenue: row.top5Revenue,
          top3Share: toNumber(row.totalRevenue) > 0 ? toNumber(row.top3Revenue) / toNumber(row.totalRevenue) : null,
          top5Share: toNumber(row.totalRevenue) > 0 ? toNumber(row.top5Revenue) / toNumber(row.totalRevenue) : null,
        })),
        weakListings,
        countryRanking: countryRankingRows,
        cityRanking: cityRankingRows,
        couponPerformanceByListing: couponPerformanceRows,
      },
      insights,
      warnings,
    });
  } catch (error) {
    console.error("order_items_summary_failed", error);
    return jsonError(500, "order_items_summary_failed");
  }
}

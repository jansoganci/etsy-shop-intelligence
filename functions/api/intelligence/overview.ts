import { queryAll, queryFirst, type D1Database } from "../reports/_summary";
import {
  buildPeriodRanges,
  calculateStability,
  classifyShopStatus,
  fillDailySeries,
  ratioChange,
  resolveDefaultMonth,
  type DateRange,
} from "./_overview";
import {
  assessCurrency,
  buildFinancialQualityWarnings,
  calculateGrossSales,
  countCoveredOrders,
  requirePaymentCoverage,
  summarizePaymentFinancials,
  type CurrencyQuality,
  type PaymentFinancialRow,
} from "./_financials";
import {
  bridgeOtherEtsyCosts,
  summarizeLedger,
  type LedgerEntryRow,
  type LedgerRateRow,
} from "./_ledger";
import { aggregateProvenance, type DataProvenance } from "./_provenance";

type Context = {
  request: Request;
  env: { DB: D1Database };
};

type CoverageRow = {
  minDate: string | null;
  maxDate: string | null;
};

type AggregateRow = {
  orderCount: number | null;
  listValue: number | null;
  discounts: number | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
  withheldDiscountRows: number | null;
};

type DailyRow = {
  date: string;
  orderCount: number | null;
  listValue: number | null;
  discounts: number | null;
};

type ListingRow = {
  listingId: string | null;
  listingTitle: string | null;
  orderCount: number | null;
  unitsSold: number | null;
  listValue: number | null;
  discounts: number | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
};

type PaymentRow = {
  orderId: string | null;
  grossAmount: number | null;
  fees: number | null;
  netAmount: number | null;
  exchangeRate: number | null;
  paymentCurrency: string | null;
  listingCurrency: string | null;
  dataSource: string | null;
};

function toNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function currencyValues(value: string | null | undefined): string[] {
  return value?.split(",").map((currency) => currency.trim()).filter(Boolean) ?? [];
}

function orderCurrencyQuality(row: AggregateRow): CurrencyQuality {
  return assessCurrency(
    currencyValues(row.currencies),
    toNumber(row.missingCurrencyRows),
    "USD",
  );
}

async function getAggregate(db: D1Database, range: DateRange): Promise<AggregateRow> {
  return (
    await queryFirst<AggregateRow>(
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
      [range.from, range.to],
    )
  ) ?? {
    orderCount: 0,
    listValue: 0,
    discounts: 0,
    currencies: null,
    missingCurrencyRows: 0,
    withheldDiscountRows: 0,
  };
}

async function getDaily(db: D1Database, range: DateRange): Promise<DailyRow[]> {
  return queryAll<DailyRow>(
    db,
    `
      SELECT
        sale_date AS date,
        COUNT(DISTINCT order_id) AS orderCount,
        SUM(order_value) AS listValue,
        SUM(COALESCE(discount_amount, 0)) AS discounts
      FROM v_orders_canonical
      WHERE sale_date BETWEEN ? AND ?
      GROUP BY sale_date
      ORDER BY sale_date
    `,
    [range.from, range.to],
  );
}

async function getListings(db: D1Database, range: DateRange): Promise<ListingRow[]> {
  return queryAll<ListingRow>(
    db,
    `
      SELECT
        COALESCE(listing_id, listing_title) AS listingId,
        MAX(listing_title) AS listingTitle,
        COUNT(DISTINCT order_id) AS orderCount,
        SUM(quantity) AS unitsSold,
        SUM(item_total) AS listValue,
        SUM(COALESCE(discount_amount, 0)) AS discounts,
        GROUP_CONCAT(DISTINCT item_currency) AS currencies,
        SUM(CASE WHEN item_currency IS NULL OR TRIM(item_currency) = '' THEN 1 ELSE 0 END)
          AS missingCurrencyRows
      FROM v_order_items_canonical
      WHERE sale_date BETWEEN ? AND ?
      GROUP BY COALESCE(listing_id, listing_title)
      ORDER BY orderCount DESC, unitsSold DESC, (listValue - discounts) DESC
    `,
    [range.from, range.to],
  );
}

async function getPayments(db: D1Database, range: DateRange): Promise<PaymentRow[]> {
  return queryAll<PaymentRow>(
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
      ORDER BY payment_id
    `,
    [range.from, range.to],
  );
}

/**
 * Every day the ledger has a TRY->USD rate for. Fetched once and shared by all
 * three periods — it is ~400 rows and independent of the range.
 */
async function getLedgerRates(db: D1Database): Promise<LedgerRateRow[]> {
  return queryAll<LedgerRateRow>(
    db,
    `
      SELECT rate_date AS rateDate, settlement_per_usd AS settlementPerUsd
      FROM v_ledger_daily_rate
    `,
  );
}

/**
 * Raw ledger rows for a period. Conversion happens in `summarizeLedger`, not in
 * SQL — resolving the carried-forward rate per row blew D1's CPU limit (see
 * migration 0030).
 */
async function getLedgerEntries(db: D1Database, range: DateRange): Promise<LedgerEntryRow[]> {
  return queryAll<LedgerEntryRow>(
    db,
    `
      SELECT entry_date AS entryDate, category,
             entry_currency AS entryCurrency, amount_try AS amountTry
      FROM v_ledger_canonical
      WHERE entry_date BETWEEN ? AND ?
    `,
    [range.from, range.to],
  );
}

function buildMetric(current: number, previous: number, previousYear: number) {
  return {
    current,
    previous,
    previousYear,
    previousChange: ratioChange(current, previous),
    previousYearChange: ratioChange(current, previousYear),
  };
}

function buildMoneyMetric(
  current: number | null,
  previous: number | null,
  previousYear: number | null,
  basis: string,
  source: string,
  provenance: DataProvenance | null,
) {
  return {
    current,
    previous,
    previousYear,
    previousChange:
      current === null || previous === null ? null : ratioChange(current, previous),
    previousYearChange:
      current === null || previousYear === null ? null : ratioChange(current, previousYear),
    currency: "USD",
    basis,
    source,
    provenance,
  };
}

async function getOrderProvenance(
  db: D1Database,
  range: DateRange,
): Promise<DataProvenance | null> {
  const rows = await queryAll<{ dataSource: string | null }>(
    db,
    `
      SELECT DISTINCT data_source AS dataSource
      FROM v_orders_canonical
      WHERE sale_date BETWEEN ? AND ?
    `,
    [range.from, range.to],
  );

  return aggregateProvenance(rows.map((row) => row.dataSource));
}

function listingMap(rows: ListingRow[]) {
  return new Map(rows.map((row) => [row.listingId ?? row.listingTitle ?? "unknown", row]));
}

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const coverage = await queryFirst<CoverageRow>(
      context.env.DB,
      `
        SELECT MIN(sale_date) AS minDate, MAX(sale_date) AS maxDate
        FROM v_orders_canonical
        WHERE sale_date IS NOT NULL
      `,
    );

    if (!coverage?.maxDate || !coverage.minDate) {
      return Response.json({ ok: false, error: "no_sales_data" }, { status: 404 });
    }

    const requestUrl = new URL(context.request.url);
    const requestedMonth = requestUrl.searchParams.get("month");
    const selectedMonth =
      requestedMonth && isValidMonth(requestedMonth)
        ? requestedMonth
        : resolveDefaultMonth(coverage.maxDate);

    if (requestedMonth && !isValidMonth(requestedMonth)) {
      return Response.json({ ok: false, error: "invalid_month" }, { status: 400 });
    }

    if (selectedMonth > coverage.maxDate.slice(0, 7)) {
      return Response.json({ ok: false, error: "month_outside_coverage" }, { status: 400 });
    }

    const ranges = buildPeriodRanges(selectedMonth, coverage.maxDate);
    const [
      currentAggregate,
      previousAggregate,
      previousYearAggregate,
      currentDailyRows,
      previousDailyRows,
      previousYearDailyRows,
      currentListings,
      previousListings,
      previousYearListings,
      currentPaymentRows,
      previousPaymentRows,
      previousYearPaymentRows,
      currentOrderProvenance,
      ledgerRates,
      currentLedgerRows,
      previousLedgerRows,
      previousYearLedgerRows,
    ] = await Promise.all([
      getAggregate(context.env.DB, ranges.current),
      getAggregate(context.env.DB, ranges.previous),
      getAggregate(context.env.DB, ranges.previousYear),
      getDaily(context.env.DB, ranges.current),
      getDaily(context.env.DB, ranges.previous),
      getDaily(context.env.DB, ranges.previousYear),
      getListings(context.env.DB, ranges.current),
      getListings(context.env.DB, ranges.previous),
      getListings(context.env.DB, ranges.previousYear),
      getPayments(context.env.DB, ranges.current),
      getPayments(context.env.DB, ranges.previous),
      getPayments(context.env.DB, ranges.previousYear),
      getOrderProvenance(context.env.DB, ranges.current),
      getLedgerRates(context.env.DB),
      getLedgerEntries(context.env.DB, ranges.current),
      getLedgerEntries(context.env.DB, ranges.previous),
      getLedgerEntries(context.env.DB, ranges.previousYear),
    ]);

    const currentPaymentProvenance = aggregateProvenance(
      currentPaymentRows.map((row) => row.dataSource),
    );

    const currentOrderCurrency = orderCurrencyQuality(currentAggregate);
    const previousOrderCurrency = orderCurrencyQuality(previousAggregate);
    const previousYearOrderCurrency = orderCurrencyQuality(previousYearAggregate);
    const currentGrossAvailable =
      currentOrderCurrency.valid && toNumber(currentAggregate.withheldDiscountRows) === 0;
    const previousGrossAvailable =
      previousOrderCurrency.valid && toNumber(previousAggregate.withheldDiscountRows) === 0;
    const previousYearGrossAvailable =
      previousYearOrderCurrency.valid && toNumber(previousYearAggregate.withheldDiscountRows) === 0;
    const currentDaily = fillDailySeries(
      ranges.current,
      currentDailyRows.map((row) => ({
        date: row.date,
        orderCount: toNumber(row.orderCount),
        grossSales: calculateGrossSales(
          toNumber(row.listValue),
          toNumber(row.discounts),
        ),
      })),
    ).map((point) => ({
      ...point,
      grossSales: currentGrossAvailable ? point.grossSales : null,
    }));
    const previousDaily = fillDailySeries(
      ranges.previous,
      previousDailyRows.map((row) => ({
        date: row.date,
        orderCount: toNumber(row.orderCount),
        grossSales: calculateGrossSales(
          toNumber(row.listValue),
          toNumber(row.discounts),
        ),
      })),
    ).map((point) => ({
      ...point,
      grossSales: previousGrossAvailable ? point.grossSales : null,
    }));
    const previousYearDaily = fillDailySeries(
      ranges.previousYear,
      previousYearDailyRows.map((row) => ({
        date: row.date,
        orderCount: toNumber(row.orderCount),
        grossSales: calculateGrossSales(
          toNumber(row.listValue),
          toNumber(row.discounts),
        ),
      })),
    ).map((point) => ({
      ...point,
      grossSales: previousYearGrossAvailable ? point.grossSales : null,
    }));
    const currentOrders = toNumber(currentAggregate.orderCount);
    const previousOrders = toNumber(previousAggregate.orderCount);
    const previousYearOrders = toNumber(previousYearAggregate.orderCount);
    const currentPayments = requirePaymentCoverage(
      summarizePaymentFinancials(currentPaymentRows),
      currentOrders,
      countCoveredOrders(currentPaymentRows),
    );
    const previousPayments = requirePaymentCoverage(
      summarizePaymentFinancials(previousPaymentRows),
      previousOrders,
      countCoveredOrders(previousPaymentRows),
    );
    const previousYearPayments = requirePaymentCoverage(
      summarizePaymentFinancials(previousYearPaymentRows),
      previousYearOrders,
      countCoveredOrders(previousYearPaymentRows),
    );
    const orderMetric = buildMetric(currentOrders, previousOrders, previousYearOrders);
    const grossSalesMetric = buildMoneyMetric(
      currentGrossAvailable
        ? calculateGrossSales(currentAggregate.listValue, currentAggregate.discounts)
        : null,
      previousGrossAvailable
        ? calculateGrossSales(previousAggregate.listValue, previousAggregate.discounts)
        : null,
      previousYearGrossAvailable
        ? calculateGrossSales(previousYearAggregate.listValue, previousYearAggregate.discounts)
        : null,
      "after_discount_before_etsy_fees",
      "sold_orders",
      currentOrderProvenance,
    );
    const etsyFeesMetric = buildMoneyMetric(
      currentPayments.etsyFeesUsd,
      previousPayments.etsyFeesUsd,
      previousYearPayments.etsyFeesUsd,
      "etsy_fees_converted_per_payment_row",
      "direct_checkout_payments",
      currentPaymentProvenance,
    );
    const netRevenueMetric = buildMoneyMetric(
      currentPayments.netRevenueUsd,
      previousPayments.netRevenueUsd,
      previousYearPayments.netRevenueUsd,
      "after_etsy_fees_converted_per_payment_row",
      "direct_checkout_payments",
      currentPaymentProvenance,
    );
    // Etsy takes more than the payment processing fee: advertising (charged
    // daily, not per order), the transaction commission, listing renewals and
    // VAT on its own services. Those live only in the ledger, so Net Revenue
    // above overstates what the shop keeps — by 45% in 2026-05.
    const currentLedger = summarizeLedger(currentLedgerRows, ledgerRates);
    const previousLedger = summarizeLedger(previousLedgerRows, ledgerRates);
    const previousYearLedger = summarizeLedger(previousYearLedgerRows, ledgerRates);

    const adSpendMetric = buildMoneyMetric(
      currentLedger.trueNetUsd === null ? null : currentLedger.categoryUsd.ads ?? 0,
      previousLedger.trueNetUsd === null ? null : previousLedger.categoryUsd.ads ?? 0,
      previousYearLedger.trueNetUsd === null ? null : previousYearLedger.categoryUsd.ads ?? 0,
      "etsy_ads_from_ledger",
      "etsy_ledger",
      null,
    );
    // Residual, so `netRevenue + adSpend + otherEtsyCosts === trueNet` always
    // holds on screen. See bridgeOtherEtsyCosts for why it is not a category sum.
    const otherEtsyCostsMetric = buildMoneyMetric(
      bridgeOtherEtsyCosts(
        currentPayments.netRevenueUsd,
        adSpendMetric.current,
        currentLedger.trueNetUsd,
      ),
      bridgeOtherEtsyCosts(
        previousPayments.netRevenueUsd,
        adSpendMetric.previous,
        previousLedger.trueNetUsd,
      ),
      bridgeOtherEtsyCosts(
        previousYearPayments.netRevenueUsd,
        adSpendMetric.previousYear,
        previousYearLedger.trueNetUsd,
      ),
      "residual_etsy_costs_from_ledger",
      "etsy_ledger",
      null,
    );
    // True Net is the ledger's own figure, not a subtraction — it is the one
    // number the balance chain verifies.
    const trueNetMetric = buildMoneyMetric(
      otherEtsyCostsMetric.current === null ? null : currentLedger.trueNetUsd,
      otherEtsyCostsMetric.previous === null ? null : previousLedger.trueNetUsd,
      otherEtsyCostsMetric.previousYear === null ? null : previousYearLedger.trueNetUsd,
      "after_all_etsy_costs_from_ledger",
      "etsy_ledger",
      null,
    );

    const stability = calculateStability(currentDaily);
    const previousMap = listingMap(previousListings);
    const previousYearMap = listingMap(previousYearListings);
    const allListingIds = new Set([
      ...currentListings.map((row) => row.listingId ?? row.listingTitle ?? "unknown"),
      ...previousListings.map((row) => row.listingId ?? row.listingTitle ?? "unknown"),
    ]);
    const currentMap = listingMap(currentListings);
    const movers = Array.from(allListingIds)
      .map((listingId) => {
        const current = currentMap.get(listingId);
        const previous = previousMap.get(listingId);
        return {
          listingId,
          title: current?.listingTitle ?? previous?.listingTitle ?? "Unknown listing",
          currentOrders: toNumber(current?.orderCount),
          previousOrders: toNumber(previous?.orderCount),
          delta: toNumber(current?.orderCount) - toNumber(previous?.orderCount),
        };
      })
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
    const totalLostOrders = movers
      .filter((item) => item.delta < 0)
      .reduce((total, item) => total + Math.abs(item.delta), 0);
    const topListings = currentListings.slice(0, 5).map((row) => {
      const listingId = row.listingId ?? row.listingTitle ?? "unknown";
      const previous = previousMap.get(listingId);
      const previousYear = previousYearMap.get(listingId);
      const listingCurrency = assessCurrency(
        currencyValues(row.currencies),
        toNumber(row.missingCurrencyRows),
        "USD",
      );

      return {
        listingId,
        title: row.listingTitle ?? "Unknown listing",
        orderCount: toNumber(row.orderCount),
        unitsSold: toNumber(row.unitsSold),
        grossSales: listingCurrency.valid
          ? calculateGrossSales(row.listValue, row.discounts)
          : null,
        currency: "USD",
        basis: "after_discount_before_etsy_fees",
        source: "sold_order_items",
        previousDelta: toNumber(row.orderCount) - toNumber(previous?.orderCount),
        previousYearDelta: toNumber(row.orderCount) - toNumber(previousYear?.orderCount),
        orderShare: currentOrders > 0 ? toNumber(row.orderCount) / currentOrders : 0,
      };
    });
    const leadingDecline = movers.find((item) => item.delta < 0) ?? null;
    const leadingGrowth = movers.find((item) => item.delta > 0) ?? null;
    const status = classifyShopStatus(orderMetric.previousChange, orderMetric.previousYearChange);
    const warnings: string[] = [];

    const periodQuality = [
      {
        key: "current",
        label: "selected",
        orders: currentOrders,
        orderCurrency: currentOrderCurrency,
        discountWithheldRows: toNumber(currentAggregate.withheldDiscountRows),
        payments: currentPayments,
      },
      {
        key: "previous",
        label: "previous",
        orders: previousOrders,
        orderCurrency: previousOrderCurrency,
        discountWithheldRows: toNumber(previousAggregate.withheldDiscountRows),
        payments: previousPayments,
      },
      {
        key: "previousYear",
        label: "previous-year",
        orders: previousYearOrders,
        orderCurrency: previousYearOrderCurrency,
        discountWithheldRows: toNumber(previousYearAggregate.withheldDiscountRows),
        payments: previousYearPayments,
      },
    ] as const;

    warnings.push(...buildFinancialQualityWarnings(periodQuality));

    if (topListings.some((listing) => listing.grossSales === null)) {
      warnings.push(
        "At least one top listing has mixed or missing item currency; its Gross Sales is unavailable.",
      );
    }

    if (currentLedger.unconvertibleCount > 0) {
      warnings.push(
        `Ad Spend, Other Etsy Costs and True Net are unavailable because ${currentLedger.unconvertibleCount} Etsy ledger row(s) in the selected period have no usable exchange rate.`,
      );
    } else if (trueNetMetric.current === null) {
      warnings.push(
        "Ad Spend, Other Etsy Costs and True Net are unavailable because Net Revenue is unavailable for the selected period.",
      );
    }

    if (currentLedger.otherCategoryCount > 0) {
      warnings.push(
        `${currentLedger.otherCategoryCount} Etsy ledger row(s) use a fee type this dashboard does not classify yet; they are counted in True Net but not broken out.`,
      );
    }

    if (ranges.current.isPartial) {
      warnings.push("The selected month is partial. Comparisons use equal day ranges.");
    }

    return Response.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      coverage,
      selectedMonth,
      ranges,
      status,
      metrics: {
        orders: orderMetric,
        grossSales: grossSalesMetric,
        etsyFees: etsyFeesMetric,
        netRevenue: netRevenueMetric,
        adSpend: adSpendMetric,
        otherEtsyCosts: otherEtsyCostsMetric,
        trueNet: trueNetMetric,
      },
      ledger: {
        categoryUsd: currentLedger.trueNetUsd === null ? {} : currentLedger.categoryUsd,
        entryCount: currentLedger.entryCount,
        unconvertibleCount: currentLedger.unconvertibleCount,
        otherCategoryCount: currentLedger.otherCategoryCount,
      },
      provenance: {
        orders: currentOrderProvenance,
        payments: currentPaymentProvenance,
      },
      stability,
      findings: {
        leadingDecline: leadingDecline
          ? {
            ...leadingDecline,
            lossContribution:
              totalLostOrders > 0 ? Math.abs(leadingDecline.delta) / totalLostOrders : 0,
          }
          : null,
        leadingGrowth,
        decliningListingCount: movers.filter((item) => item.delta < 0).length,
        growingListingCount: movers.filter((item) => item.delta > 0).length,
      },
      topListings,
      dailyTrend: {
        current: currentDaily,
        previous: previousDaily,
        previousYear: previousYearDaily,
      },
      financialDataQuality: Object.fromEntries(
        periodQuality.map((period) => [
          period.key,
          {
            orderCurrency: period.orderCurrency,
            payments: period.payments,
          },
        ]),
      ),
      warnings,
    });
  } catch (error) {
    console.error("intelligence_overview_failed", error);
    return Response.json({ ok: false, error: "intelligence_overview_failed" }, { status: 500 });
  }
}

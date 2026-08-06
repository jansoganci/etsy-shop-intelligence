import { queryAll, queryFirst, type D1Database } from "../reports/_summary";
import {
  buildPeriodRanges,
  calculateStability,
  classifyShopStatus,
  fillDailySeries,
  ratioChange,
  resolveDefaultMonth,
  type DateRange,
} from "../intelligence/_overview";
import {
  assessCurrency,
  buildFinancialQualityWarnings,
  calculateGrossSales,
  countCoveredOrders,
  requirePaymentCoverage,
  summarizePaymentFinancials,
  type CurrencyQuality,
} from "../intelligence/_financials";
import {
  bridgeOtherEtsyCosts,
  summarizeLedger,
  type LedgerEntryRow,
  type LedgerRateRow,
} from "../intelligence/_ledger";
import { aggregateProvenance, type DataProvenance } from "../intelligence/_provenance";

type CoverageRow = { minDate: string | null; maxDate: string | null };

type AggregateRow = {
  orderCount: number | null;
  listValue: number | null;
  discounts: number | null;
  currencies: string | null;
  missingCurrencyRows: number | null;
  withheldDiscountRows: number | null;
};

type DailyRow = { date: string; orderCount: number | null };

export type ListingAggRow = {
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

function orderCurrencyQuality(row: AggregateRow | ListingAggRow): CurrencyQuality {
  return assessCurrency(currencyValues(row.currencies), toNumber(row.missingCurrencyRows), "USD");
}

async function resolveMonth(
  db: D1Database,
  requestedMonth?: string,
): Promise<{ month: string; coverage: { minDate: string; maxDate: string } } | null> {
  const coverage = await queryFirst<CoverageRow>(
    db,
    `SELECT MIN(sale_date) AS minDate, MAX(sale_date) AS maxDate FROM v_orders_canonical WHERE sale_date IS NOT NULL`,
  );
  if (!coverage?.maxDate || !coverage.minDate) {
    return null;
  }
  const month =
    requestedMonth && isValidMonth(requestedMonth)
      ? requestedMonth
      : resolveDefaultMonth(coverage.maxDate);
  return { month, coverage: { minDate: coverage.minDate, maxDate: coverage.maxDate } };
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
      SELECT sale_date AS date, COUNT(DISTINCT order_id) AS orderCount
      FROM v_orders_canonical
      WHERE sale_date BETWEEN ? AND ?
      GROUP BY sale_date
      ORDER BY sale_date
    `,
    [range.from, range.to],
  );
}

export async function getListingAgg(db: D1Database, range: DateRange): Promise<ListingAggRow[]> {
  return queryAll<ListingAggRow>(
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

async function getOrderProvenance(db: D1Database, range: DateRange): Promise<DataProvenance | null> {
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

async function getPayments(db: D1Database, range: DateRange): Promise<PaymentRow[]> {
  return queryAll<PaymentRow>(
    db,
    `
      SELECT
        order_id AS orderId,
        gross_amount AS grossAmount, fees, net_amount AS netAmount,
        exchange_rate AS exchangeRate, payment_currency AS paymentCurrency,
        listing_currency AS listingCurrency, data_source AS dataSource
      FROM v_payments_canonical
      WHERE order_date BETWEEN ? AND ?
    `,
    [range.from, range.to],
  );
}

function moneyMetric(
  current: number | null,
  previous: number | null,
  previousYear: number | null,
) {
  return {
    current,
    previousChange: current === null || previous === null ? null : ratioChange(current, previous),
    previousYearChange:
      current === null || previousYear === null ? null : ratioChange(current, previousYear),
  };
}

async function getLedgerRates(db: D1Database): Promise<LedgerRateRow[]> {
  return queryAll<LedgerRateRow>(
    db,
    `
      SELECT rate_date AS rateDate, settlement_per_usd AS settlementPerUsd
      FROM v_ledger_daily_rate
    `,
  );
}

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

export type ShopOverviewTool = {
  month: string;
  range: { from: string; to: string; isPartial: boolean };
  status: string;
  currency: "USD";
  orders: { current: number; previousChange: number | null; previousYearChange: number | null };
  grossSalesUsd: ReturnType<typeof moneyMetric>;
  /** After the Etsy payment processing fee only — this is NOT profit. */
  netRevenueUsd: ReturnType<typeof moneyMetric>;
  /** Etsy Ads, charged daily against the account balance, not per order. */
  adSpendUsd: ReturnType<typeof moneyMetric>;
  /** Commission, listing renewals, VAT and the net effect of refunds. */
  otherEtsyCostsUsd: ReturnType<typeof moneyMetric>;
  /** What the shop actually keeps: netRevenue + adSpend + otherEtsyCosts. */
  trueNetUsd: ReturnType<typeof moneyMetric>;
  stability: {
    dailyAverage: number;
    activeDayRate: number;
    zeroSalesDays: number;
    targetBandRate: number;
    longestZeroSalesStreak: number;
    averageTargetMet: boolean;
    coverageTargetMet: boolean;
  };
  source: string;
  provenance: {
    orders: DataProvenance | null;
    payments: DataProvenance | null;
  };
  warnings: string[];
};

export async function computeShopOverview(
  db: D1Database,
  requestedMonth?: string,
): Promise<ShopOverviewTool | { error: string }> {
  const resolved = await resolveMonth(db, requestedMonth);
  if (!resolved) {
    return { error: "no_sales_data" };
  }

  const ranges = buildPeriodRanges(resolved.month, resolved.coverage.maxDate);
  const [
    currentAgg,
    previousAgg,
    previousYearAgg,
    currentDailyRows,
    currentPaymentRows,
    previousPaymentRows,
    previousYearPaymentRows,
    currentOrderProvenance,
    ledgerRates,
    currentLedgerRows,
    previousLedgerRows,
    previousYearLedgerRows,
  ] = await Promise.all([
    getAggregate(db, ranges.current),
    getAggregate(db, ranges.previous),
    getAggregate(db, ranges.previousYear),
    getDaily(db, ranges.current),
    getPayments(db, ranges.current),
    getPayments(db, ranges.previous),
    getPayments(db, ranges.previousYear),
    getOrderProvenance(db, ranges.current),
    getLedgerRates(db),
    getLedgerEntries(db, ranges.current),
    getLedgerEntries(db, ranges.previous),
    getLedgerEntries(db, ranges.previousYear),
  ]);

  const currentPaymentProvenance = aggregateProvenance(
    currentPaymentRows.map((row) => row.dataSource),
  );

  const currentOrders = toNumber(currentAgg.orderCount);
  const previousOrders = toNumber(previousAgg.orderCount);
  const previousYearOrders = toNumber(previousYearAgg.orderCount);

  const currentCurrency = orderCurrencyQuality(currentAgg);
  const previousCurrency = orderCurrencyQuality(previousAgg);
  const previousYearCurrency = orderCurrencyQuality(previousYearAgg);

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

  const grossSalesUsd = moneyMetric(
    currentCurrency.valid && toNumber(currentAgg.withheldDiscountRows) === 0
      ? calculateGrossSales(currentAgg.listValue, currentAgg.discounts)
      : null,
    previousCurrency.valid && toNumber(previousAgg.withheldDiscountRows) === 0
      ? calculateGrossSales(previousAgg.listValue, previousAgg.discounts)
      : null,
    previousYearCurrency.valid && toNumber(previousYearAgg.withheldDiscountRows) === 0
      ? calculateGrossSales(previousYearAgg.listValue, previousYearAgg.discounts)
      : null,
  );
  const netRevenueUsd = moneyMetric(
    currentPayments.netRevenueUsd,
    previousPayments.netRevenueUsd,
    previousYearPayments.netRevenueUsd,
  );

  // Net Revenue is only after the payment processing fee. Advertising, the
  // transaction commission, listing renewals and VAT live in the ledger, so the
  // analyst must have True Net or it will overstate profit — by 45% in 2026-05.
  const currentLedger = summarizeLedger(currentLedgerRows, ledgerRates);
  const previousLedger = summarizeLedger(previousLedgerRows, ledgerRates);
  const previousYearLedger = summarizeLedger(previousYearLedgerRows, ledgerRates);

  const adSpend = (summary: ReturnType<typeof summarizeLedger>): number | null =>
    summary.trueNetUsd === null ? null : summary.categoryUsd.ads ?? 0;

  const currentAds = adSpend(currentLedger);
  const previousAds = adSpend(previousLedger);
  const previousYearAds = adSpend(previousYearLedger);

  const currentOther = bridgeOtherEtsyCosts(
    currentPayments.netRevenueUsd,
    currentAds,
    currentLedger.trueNetUsd,
  );
  const previousOther = bridgeOtherEtsyCosts(
    previousPayments.netRevenueUsd,
    previousAds,
    previousLedger.trueNetUsd,
  );
  const previousYearOther = bridgeOtherEtsyCosts(
    previousYearPayments.netRevenueUsd,
    previousYearAds,
    previousYearLedger.trueNetUsd,
  );

  const adSpendUsd = moneyMetric(currentAds, previousAds, previousYearAds);
  const otherEtsyCostsUsd = moneyMetric(currentOther, previousOther, previousYearOther);
  const trueNetUsd = moneyMetric(
    currentOther === null ? null : currentLedger.trueNetUsd,
    previousOther === null ? null : previousLedger.trueNetUsd,
    previousYearOther === null ? null : previousYearLedger.trueNetUsd,
  );

  const orderPreviousChange = ratioChange(currentOrders, previousOrders);
  const orderPreviousYearChange = ratioChange(currentOrders, previousYearOrders);
  const status = classifyShopStatus(orderPreviousChange, orderPreviousYearChange);

  const stability = calculateStability(
    fillDailySeries(
      ranges.current,
      currentDailyRows.map((row) => ({
        date: row.date,
        orderCount: toNumber(row.orderCount),
        grossSales: null,
      })),
    ),
  );

  const warnings = buildFinancialQualityWarnings([
    {
      label: "selected",
      orders: currentOrders,
      orderCurrency: currentCurrency,
      discountWithheldRows: toNumber(currentAgg.withheldDiscountRows),
      payments: currentPayments,
    },
    {
      label: "previous",
      orders: previousOrders,
      orderCurrency: previousCurrency,
      discountWithheldRows: toNumber(previousAgg.withheldDiscountRows),
      payments: previousPayments,
    },
    {
      label: "previous-year",
      orders: previousYearOrders,
      orderCurrency: previousYearCurrency,
      discountWithheldRows: toNumber(previousYearAgg.withheldDiscountRows),
      payments: previousYearPayments,
    },
  ]);
  if (trueNetUsd.current === null) {
    warnings.push(
      "True Net is unavailable for the selected period, so only Net Revenue (after payment fees) can be quoted.",
    );
  }
  if (ranges.current.isPartial) {
    warnings.push("The selected month is partial. Comparisons use equal day ranges.");
  }

  return {
    month: resolved.month,
    range: { from: ranges.current.from, to: ranges.current.to, isPartial: ranges.current.isPartial },
    status,
    currency: "USD",
    orders: {
      current: currentOrders,
      previousChange: orderPreviousChange,
      previousYearChange: orderPreviousYearChange,
    },
    grossSalesUsd,
    netRevenueUsd,
    adSpendUsd,
    otherEtsyCostsUsd,
    trueNetUsd,
    stability: {
      dailyAverage: stability.dailyAverage,
      activeDayRate: stability.activeDayRate,
      zeroSalesDays: stability.zeroSalesDays,
      targetBandRate: stability.targetBandRate,
      longestZeroSalesStreak: stability.longestZeroSalesStreak,
      averageTargetMet: stability.averageTargetMet,
      coverageTargetMet: stability.coverageTargetMet,
    },
    source: "sold_orders + direct_checkout_payments",
    provenance: {
      orders: currentOrderProvenance,
      payments: currentPaymentProvenance,
    },
    warnings,
  };
}

export type StabilityTool = {
  month: string;
  range: { from: string; to: string; isPartial: boolean };
  dayCount: number;
  activeDays: number;
  zeroSalesDays: number;
  activeDayRate: number;
  dailyAverage: number;
  targetBandDays: number;
  targetBandRate: number;
  longestZeroSalesStreak: number;
  averageTargetMet: boolean;
  coverageTargetMet: boolean;
  source: string;
  warnings: string[];
};

export async function computeStabilityMetrics(
  db: D1Database,
  requestedMonth?: string,
): Promise<StabilityTool | { error: string }> {
  const resolved = await resolveMonth(db, requestedMonth);
  if (!resolved) {
    return { error: "no_sales_data" };
  }
  const ranges = buildPeriodRanges(resolved.month, resolved.coverage.maxDate);
  const dailyRows = await getDaily(db, ranges.current);
  const stability = calculateStability(
    fillDailySeries(
      ranges.current,
      dailyRows.map((row) => ({ date: row.date, orderCount: toNumber(row.orderCount), grossSales: null })),
    ),
  );
  const warnings: string[] = [];
  if (ranges.current.isPartial) {
    warnings.push("The selected month is partial. Metrics cover the partial range only.");
  }
  return {
    month: resolved.month,
    range: { from: ranges.current.from, to: ranges.current.to, isPartial: ranges.current.isPartial },
    ...stability,
    source: "sold_orders",
    warnings,
  };
}

export type TopListingTool = {
  listingId: string;
  title: string;
  orderCount: number;
  unitsSold: number;
  grossSalesUsd: number | null;
  previousDelta: number;
  orderShare: number;
};

export type TopListingsResult = {
  month: string;
  range: { from: string; to: string; isPartial: boolean };
  listings: TopListingTool[];
  source: string;
  warnings: string[];
};

export async function computeTopListings(
  db: D1Database,
  requestedMonth?: string,
  limit = 5,
): Promise<TopListingsResult | { error: string }> {
  const resolved = await resolveMonth(db, requestedMonth);
  if (!resolved) {
    return { error: "no_sales_data" };
  }
  const ranges = buildPeriodRanges(resolved.month, resolved.coverage.maxDate);
  const [currentListings, previousListings, currentAgg] = await Promise.all([
    getListingAgg(db, ranges.current),
    getListingAgg(db, ranges.previous),
    getAggregate(db, ranges.current),
  ]);
  const previousMap = new Map(
    previousListings.map((row) => [row.listingId ?? row.listingTitle ?? "unknown", row]),
  );
  const currentOrders = toNumber(currentAgg.orderCount);
  const boundedLimit = Math.min(Math.max(1, limit), 20);
  const warnings: string[] = [];

  const listings = currentListings.slice(0, boundedLimit).map((row) => {
    const listingId = row.listingId ?? row.listingTitle ?? "unknown";
    const previous = previousMap.get(listingId);
    const currency = orderCurrencyQuality(row);
    if (!currency.valid) {
      warnings.push(`Listing ${listingId} has mixed or missing item currency.`);
    }
    return {
      listingId,
      title: row.listingTitle ?? "Unknown listing",
      orderCount: toNumber(row.orderCount),
      unitsSold: toNumber(row.unitsSold),
      grossSalesUsd: currency.valid ? calculateGrossSales(row.listValue, row.discounts) : null,
      previousDelta: toNumber(row.orderCount) - toNumber(previous?.orderCount),
      orderShare: currentOrders > 0 ? toNumber(row.orderCount) / currentOrders : 0,
    };
  });

  if (ranges.current.isPartial) {
    warnings.push("The selected month is partial. Comparisons use equal day ranges.");
  }

  return {
    month: resolved.month,
    range: { from: ranges.current.from, to: ranges.current.to, isPartial: ranges.current.isPartial },
    listings,
    source: "sold_order_items",
    warnings,
  };
}

export type ListingMoverTool = {
  listingId: string;
  title: string;
  currentOrders: number;
  previousOrders: number;
  delta: number;
};

export type ListingMoversResult = {
  month: string;
  range: { from: string; to: string; isPartial: boolean };
  leadingDecline: (ListingMoverTool & { lossContribution: number }) | null;
  leadingGrowth: ListingMoverTool | null;
  decliningListingCount: number;
  growingListingCount: number;
  source: string;
  warnings: string[];
};

export async function computeListingMovers(
  db: D1Database,
  requestedMonth?: string,
): Promise<ListingMoversResult | { error: string }> {
  const resolved = await resolveMonth(db, requestedMonth);
  if (!resolved) {
    return { error: "no_sales_data" };
  }
  const ranges = buildPeriodRanges(resolved.month, resolved.coverage.maxDate);
  const [currentListings, previousListings] = await Promise.all([
    getListingAgg(db, ranges.current),
    getListingAgg(db, ranges.previous),
  ]);
  const currentMap = new Map(
    currentListings.map((row) => [row.listingId ?? row.listingTitle ?? "unknown", row]),
  );
  const previousMap = new Map(
    previousListings.map((row) => [row.listingId ?? row.listingTitle ?? "unknown", row]),
  );
  const allIds = new Set([...currentMap.keys(), ...previousMap.keys()]);

  const movers = Array.from(allIds)
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
  const leadingDeclineRaw = movers.find((item) => item.delta < 0) ?? null;
  const leadingGrowth = movers.find((item) => item.delta > 0) ?? null;

  const warnings: string[] = [];
  if (ranges.current.isPartial) {
    warnings.push("The selected month is partial. Comparisons use equal day ranges.");
  }

  return {
    month: resolved.month,
    range: { from: ranges.current.from, to: ranges.current.to, isPartial: ranges.current.isPartial },
    leadingDecline: leadingDeclineRaw
      ? {
        ...leadingDeclineRaw,
        lossContribution:
          totalLostOrders > 0 ? Math.abs(leadingDeclineRaw.delta) / totalLostOrders : 0,
      }
      : null,
    leadingGrowth,
    decliningListingCount: movers.filter((item) => item.delta < 0).length,
    growingListingCount: movers.filter((item) => item.delta > 0).length,
    source: "sold_order_items",
    warnings,
  };
}

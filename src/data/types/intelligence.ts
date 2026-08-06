export type IntelligenceDateRange = {
  from: string;
  to: string;
  month: string;
  dayCount: number;
  isPartial: boolean;
};

export type IntelligenceMetric = {
  current: number;
  previous: number;
  previousYear: number;
  previousChange: number | null;
  previousYearChange: number | null;
};

export type DataProvenance = "csv_upload" | "etsy_api" | "etsy_api+csv" | "mixed";

export type IntelligenceMoneyMetric = {
  current: number | null;
  previous: number | null;
  previousYear: number | null;
  previousChange: number | null;
  previousYearChange: number | null;
  currency: "USD";
  basis:
    | "after_discount_before_etsy_fees"
    | "etsy_fees_converted_per_payment_row"
    | "after_etsy_fees_converted_per_payment_row"
    | "etsy_ads_from_ledger"
    | "residual_etsy_costs_from_ledger"
    | "after_all_etsy_costs_from_ledger";
  source: "sold_orders" | "direct_checkout_payments" | "etsy_ledger";
  provenance: DataProvenance | null;
};

/**
 * The Etsy account ledger behind True Net. `categoryUsd` is the literal
 * per-category breakdown for the selected period; it is for display only —
 * `metrics.otherEtsyCosts` is a residual so the on-screen chain always adds up
 * (see `bridgeOtherEtsyCosts`).
 */
export type IntelligenceLedgerBlock = {
  categoryUsd: Record<string, number>;
  entryCount: number;
  unconvertibleCount: number;
  otherCategoryCount: number;
};

export type IntelligenceCurrencyQuality = {
  valid: boolean;
  expectedCurrency: string;
  currencies: string[];
  missingCurrencyRows: number;
};

export type IntelligencePaymentQuality = {
  valid: boolean;
  paymentRowCount: number;
  invalidRowCount: number;
  paymentCurrencies: string[];
  listingCurrencies: string[];
  paymentGrossUsd: number | null;
  etsyFeesUsd: number | null;
  netRevenueUsd: number | null;
  reconciliationDeltaUsd: number | null;
};

export type IntelligenceOverviewResponse = {
  ok: true;
  generatedAt: string;
  coverage: {
    minDate: string;
    maxDate: string;
  };
  selectedMonth: string;
  ranges: {
    current: IntelligenceDateRange;
    previous: IntelligenceDateRange;
    previousYear: IntelligenceDateRange;
  };
  status: "declining" | "slowing" | "stable" | "recovering" | "growing" | "insufficient_data";
  metrics: {
    orders: IntelligenceMetric;
    grossSales: IntelligenceMoneyMetric;
    etsyFees: IntelligenceMoneyMetric;
    netRevenue: IntelligenceMoneyMetric;
    /** Etsy Ads, charged daily against the account balance, not per order. */
    adSpend: IntelligenceMoneyMetric;
    /** Commission, listing renewals, VAT and the net effect of refunds. */
    otherEtsyCosts: IntelligenceMoneyMetric;
    /** What the shop actually keeps: netRevenue + adSpend + otherEtsyCosts. */
    trueNet: IntelligenceMoneyMetric;
  };
  ledger: IntelligenceLedgerBlock;
  provenance: {
    orders: DataProvenance | null;
    payments: DataProvenance | null;
  };
  stability: {
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
  };
  findings: {
    leadingDecline: {
      listingId: string;
      title: string;
      currentOrders: number;
      previousOrders: number;
      delta: number;
      lossContribution: number;
    } | null;
    leadingGrowth: {
      listingId: string;
      title: string;
      currentOrders: number;
      previousOrders: number;
      delta: number;
    } | null;
    decliningListingCount: number;
    growingListingCount: number;
  };
  topListings: Array<{
    listingId: string;
    title: string;
    orderCount: number;
    unitsSold: number;
    grossSales: number | null;
    currency: "USD";
    basis: "after_discount_before_etsy_fees";
    source: "sold_order_items";
    previousDelta: number;
    previousYearDelta: number;
    orderShare: number;
  }>;
  dailyTrend: {
    current: Array<{ date: string; orderCount: number; grossSales: number | null }>;
    previous: Array<{ date: string; orderCount: number; grossSales: number | null }>;
    previousYear: Array<{ date: string; orderCount: number; grossSales: number | null }>;
  };
  financialDataQuality: {
    current: {
      orderCurrency: IntelligenceCurrencyQuality;
      payments: IntelligencePaymentQuality;
    };
    previous: {
      orderCurrency: IntelligenceCurrencyQuality;
      payments: IntelligencePaymentQuality;
    };
    previousYear: {
      orderCurrency: IntelligenceCurrencyQuality;
      payments: IntelligencePaymentQuality;
    };
  };
  warnings: string[];
};

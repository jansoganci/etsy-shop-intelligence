export type ReportComparisonMode = "previous_period" | "previous_year" | "none";
export type ReportSortDirection = "asc" | "desc";

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  country?: string;
  city?: string;
  currency?: string;
  couponUsed?: boolean;
  couponCode?: string;
  status?: string;
  orderId?: string;
  listingId?: string;
  paymentId?: string;
  q?: string;
  compare?: ReportComparisonMode;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number | string | null;
  formattedValue: string;
  currency?: string | null;
  unit?: "count" | "percent" | "money" | "ratio" | "days" | null;
  previousValue?: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
  direction?: "up" | "down" | "flat" | "unknown";
  note?: string;
}

export interface InsightBlock {
  key: string;
  title: string;
  severity: "positive" | "warning" | "neutral" | "opportunity";
  message: string;
  metricKeys?: string[];
  action?: string;
}

export type ReportDataProvenance = "csv_upload" | "etsy_api" | "etsy_api+csv" | "mixed";

export interface ReportSummaryResponse {
  report: "orders" | "order_items" | "payments";
  filters: Record<string, string | boolean | null>;
  dateRange: {
    from: string | null;
    to: string | null;
  };
  comparison: {
    mode: ReportComparisonMode;
    from: string | null;
    to: string | null;
  };
  provenance?: {
    orders?: ReportDataProvenance | null;
    payments?: ReportDataProvenance | null;
  };
  kpis: KpiCard[];
  charts: Record<string, unknown>;
  insights: InsightBlock[];
  warnings: string[];
}

export interface ReportTableRequest extends ReportFilters {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: ReportSortDirection;
}

export interface ReportTableResponse<TRow = Record<string, unknown>> {
  ok: true;
  rows: TRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  sortBy: string;
  sortDir: ReportSortDirection;
  filters: Record<string, string | null>;
}

export interface OrderItemsTableRow {
  transactionId: string | null;
  orderId: string | null;
  listingId: string | null;
  saleDate: string | null;
  saleDateRaw: string | null;
  listingTitle: string | null;
  quantity: number | null;
  price: number | null;
  couponCode: string | null;
  couponDetails: string | null;
  discountAmount: number | null;
  shippingDiscount: number | null;
  orderShipping: number | null;
  orderSalesTax: number | null;
  itemTotal: number | null;
  itemCurrency: string | null;
  datePaid: string | null;
  dateShipped: string | null;
  shipCountry: string | null;
  shipCity: string | null;
  variations: string | null;
  orderType: string | null;
  listingsType: string | null;
  paymentType: string | null;
  vatPaidByBuyer: number | null;
  sku: string | null;
}

export interface OrdersTableRow {
  orderId: string | null;
  saleDate: string | null;
  saleDateRaw: string | null;
  numberOfItems: number | null;
  shipCountry: string | null;
  shipCity: string | null;
  orderCurrency: string | null;
  orderValue: number | null;
  couponCode: string | null;
  couponDetails: string | null;
  discountAmount: number | null;
  averageExchangeRate: number | null;
  revenueAfterDiscount: number | null;
  netUsdRevenue: number | null;
  profitMargin: number | null;
  shippingDiscount: number | null;
  shipping: number | null;
  salesTax: number | null;
  orderTotal: number | null;
  orderStatus: string | null;
  payoutCardProcessingFees: number | null;
  payoutOrderNet: number | null;
  adjustedOrderTotal: number | null;
  payoutAdjustedCardProcessingFees: number | null;
  payoutAdjustedNetOrderAmount: number | null;
  orderType: string | null;
  paymentType: string | null;
  sku: string | null;
}

export interface PaymentsTableRow {
  paymentId: string | null;
  orderId: string | null;
  orderDate: string | null;
  orderDateRaw: string | null;
  fundsAvailableDate: string | null;
  fundsAvailableRaw: string | null;
  grossAmount: number | null;
  fees: number | null;
  netAmount: number | null;
  postedGross: number | null;
  postedFees: number | null;
  postedNet: number | null;
  adjustedGross: number | null;
  adjustedFees: number | null;
  adjustedNet: number | null;
  paymentCurrency: string | null;
  listingAmount: number | null;
  listingCurrency: string | null;
  exchangeRate: number | null;
  vatAmount: number | null;
  giftCardApplied: number | null;
  paymentStatus: string | null;
  orderType: string | null;
  paymentType: string | null;
  refundAmount: number | null;
}

export type DataCenterSourceCoverage = {
  firstMonth: string | null;
  lastMonth: string | null;
  missingMonths: string[];
};

export type DataCenterCoverage = {
  lastCompletedMonth: string;
  sources: {
    sold_orders: DataCenterSourceCoverage;
    sold_order_items: DataCenterSourceCoverage;
    direct_checkout_payments: DataCenterSourceCoverage;
  };
};

export type EtsyReconciliationStatus = "MATCHED" | "MISMATCH" | "NOT_ENOUGH_DATA";

export type EtsyReconciliationDateRange = {
  min: string | null;
  max: string | null;
};

export type EtsyReconciliationCounts = {
  apiCount: number;
  csvCount: number;
  matchedCount: number;
  apiOnlyCount: number;
  csvOnlyCount: number;
  status: EtsyReconciliationStatus;
  reason?: string;
  readiness: { api: boolean; csv: boolean };
  coverage: {
    api: EtsyReconciliationDateRange;
    csv: EtsyReconciliationDateRange;
    common: EtsyReconciliationDateRange;
  };
  outOfCoverageCount: { api: number; csv: number };
  cardinalityWarning: boolean;
  orphanCount?: { api: number | null; csv: number | null };
  parentMismatchCount?: number | null;
};

export type EtsyReconciliationStub = {
  status: "NOT_ENOUGH_DATA";
  reason: string;
};

export type FinancialMetricStatus = "MATCHED" | "WARNING" | "MISMATCH" | "NOT_ENOUGH_DATA";

export type FinancialConversionMethod = "identity" | "csv_row_rate" | "mixed" | "unavailable";

export type FinancialMetric = {
  key: string;
  label: string;
  businessBasis: string;
  apiValue: number | null;
  csvValue: number | null;
  currency: string | null;
  difference: number | null;
  differencePercentage: number | null;
  status: FinancialMetricStatus;
  reason?: string;
  conversion?: {
    apiMethod: FinancialConversionMethod;
    csvMethod: FinancialConversionMethod;
    apiUnconvertibleCount: number;
    csvUnconvertibleCount: number;
  };
};

export type MonthlyFinancialEntry = {
  month: string;
  orderCount: { api: number; csv: number } | null;
  paymentCount: { api: number; csv: number } | null;
  metrics: FinancialMetric[];
  status: FinancialMetricStatus;
};

export type MonthlyFinancialsResult = {
  months: MonthlyFinancialEntry[];
  status: FinancialMetricStatus;
  ordersAvailable: boolean;
  paymentsAvailable: boolean;
};

export type DateBoundaryMonthShift = {
  sourceMonth: string;
  reportingMonth: string;
  count: number;
};

export type DateBoundarySummary = {
  timezone: string;
  available: boolean;
  shiftedRecordCount: number;
  shiftedAmount: number | null;
  monthPairs: DateBoundaryMonthShift[];
};

export type DateBoundaryResult = {
  orders: DateBoundarySummary;
  payments: DateBoundarySummary;
};

export type EtsyReconciliation = {
  orders: EtsyReconciliationCounts;
  orderItems: EtsyReconciliationCounts;
  payments: EtsyReconciliationCounts;
  listings: EtsyReconciliationStub;
  refunds: EtsyReconciliationStub;
  reviews: EtsyReconciliationStub;
  overallStatus: EtsyReconciliationStatus;
  calculatedAt: string;
  syncInProgress: boolean;
  monthlyFinancials: MonthlyFinancialsResult;
  dateBoundary: DateBoundaryResult;
};

export type ReconciliationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ReconciliationRun = {
  id: string;
  shopId: string;
  status: ReconciliationRunStatus;
  triggerType: "manual" | "sync_generation";
  reportingTimezone: string;
  rulesVersion: string;
  apiSyncRunId: string | null;
  csvImportWatermark: string | null;
  progress: { completed: number; total: number; currentStep: string | null };
  errorCode: string | null;
  errorMessage: string | null;
  summary: EtsyReconciliation | null;
  shadow: {
    status?: "match" | "different" | "no_legacy_generation";
    legacyGenerationRunId?: string;
    differingEntities?: string[];
  } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type ReconciliationRunStatusResponse = {
  latestAttempt: ReconciliationRun | null;
  latestCompleted: ReconciliationRun | null;
  sourceBusy: { etsySync: boolean; csvImport: boolean };
};

export type IssueEntity = "orders" | "orderItems" | "payments";

export type IssueType =
  | "missing_in_api"
  | "missing_in_csv"
  | "orphan_api"
  | "orphan_csv"
  | "parent_mismatch"
  | "financial_difference";

export type IssueRecord = {
  id: string;
  date: string | null;
  amount: number | null;
  currency: string | null;
  detail?: string;
  status?: "WARNING" | "MISMATCH" | "BLOCKING";
  reasonCode?: string;
  fieldName?: string;
  apiValue?: number | null;
  csvValue?: number | null;
  difference?: number | null;
};

export type IssuesPage = {
  entity: IssueEntity;
  type: IssueType;
  items: IssueRecord[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export const ISSUE_TYPES_BY_ENTITY: Record<IssueEntity, IssueType[]> = {
  orders: ["missing_in_api", "missing_in_csv", "financial_difference"],
  orderItems: ["missing_in_api", "missing_in_csv", "orphan_api", "orphan_csv", "parent_mismatch"],
  payments: ["missing_in_api", "missing_in_csv", "orphan_api", "orphan_csv", "parent_mismatch", "financial_difference"],
};

export type FinancialCutoverEntity = "orders" | "payments";

export type FinancialCutoverReadiness = {
  entityStatus: EtsyReconciliationStatus;
  financialStatus: FinancialMetricStatus;
  allowed: boolean;
  blockingReasons: string[];
  warnings: string[];
};

export type FinancialCutoverSettings = {
  ordersApiFirst: boolean;
  paymentsApiFirst: boolean;
  updatedAt: string | null;
};

export type FinancialCutoverStatus = {
  shopId: string;
  settings: FinancialCutoverSettings;
  readiness: Record<FinancialCutoverEntity, FinancialCutoverReadiness>;
};

export type ReviewSort =
  | "newest"
  | "oldest"
  | "rating_high"
  | "rating_low"
  | "updated";

export type EtsyReviewRow = {
  reviewKey: string;
  createTimestamp: number | null;
  updateTimestamp: number | null;
  rating: number;
  reviewText: string | null;
  language: string | null;
  imageUrl: string | null;
  listingId: string | null;
  listingTitle: string | null;
  transactionId: string | null;
  receiptId: string | null;
};

export type EtsyReviewListingOption = {
  listingId: string;
  listingTitle: string | null;
};

export type EtsyReviewsResponse = {
  reviews: EtsyReviewRow[];
  summary: {
    totalCount: number;
    averageRating: number | null;
    distribution: Record<number, number>;
  };
  listings: EtsyReviewListingOption[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  filters: {
    q: string | null;
    rating: number | null;
    listingId: string | null;
    sort: ReviewSort;
  };
  capabilities: {
    buyerName: boolean;
    sellerResponse: boolean;
    responseStatus: boolean;
  };
};

export type EtsyReviewsQuery = {
  q?: string;
  rating?: number;
  dateFrom?: string;
  dateTo?: string;
  listingId?: string;
  sort?: ReviewSort;
  page?: number;
  pageSize?: number;
};

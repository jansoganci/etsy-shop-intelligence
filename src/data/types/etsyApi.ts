export type EtsySyncResource = "commerce" | "shop" | "listings" | "reviews";

export type CommercePeriodInput = {
  from: string;
  to: string;
};

export type CommerceSyncStage =
  | "queued"
  | "shop"
  | "receipts"
  | "payments"
  | "ledger"
  | "finishing";

export type EtsySyncPeriod = {
  fromTs: number;
  toExclusiveTs: number;
};

export type EtsyConnection = {
  shopId: string;
  shopName: string | null;
  scopes: string[];
  status: "connected" | "reauthorization_required";
  connectedAt: string;
  lastApiSuccessAt: string | null;
  accessTokenExpiresAt: string;
};

export type EtsySyncResourceProgress = {
  resource: string;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type EtsySyncRun = {
  id: string;
  shopId: string;
  requestedResource: EtsySyncResource;
  status: string;
  controlState?: string;
  pauseReason?: string | null;
  currentResource: string | null;
  qpdRemaining: number | null;
  qpsRemaining: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  resources: EtsySyncResourceProgress[];
  totalTasks?: number;
  completedTasks?: number;
  failedTasks?: number;
  remainingParents?: number;
  lastHeartbeatAt?: string | null;
  nextResumeAt?: string | null;
  isPeriodRun?: boolean;
  period?: EtsySyncPeriod | null;
  stage?: CommerceSyncStage;
  softBudget?: {
    dayKey: string;
    queueOps: number;
    d1WriteOps: number;
  };
  taskCounts?: Record<string, number>;
};

export type EtsyConnectionStatus = {
  connection: EtsyConnection | null;
  latestRun: Omit<EtsySyncRun, "resources"> | null;
};

export type CommerceCoverageWatermark = {
  cursorValue: number | null;
  lastSuccessAt: string | null;
};

export type CommerceCoveragePeriod = {
  fromTs: number;
  toExclusiveTs: number;
  fromDate: string;
  toDate: string;
  status: string;
  etsyReceiptCount: number | null;
  persistedReceiptCount: number | null;
  paymentParentsSelected: number | null;
  paymentParentsChecked: number | null;
  ledgerComplete: boolean;
  firstSyncedAt: string | null;
  lastRefreshedAt: string | null;
};

export type CommerceCsvPresence = {
  month: string;
  orders: boolean;
  orderItems: boolean;
  payments: boolean;
};

export type CommerceCoverage = {
  watermark: CommerceCoverageWatermark;
  periods: CommerceCoveragePeriod[];
  csvPresence: CommerceCsvPresence[];
};

export type CommerceSummaryStatus = "complete" | "partial" | "failed" | "running";

export type CommerceMoneyField = {
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
  grossSales: CommerceMoneyField;
  discounts: CommerceMoneyField;
  refunds: CommerceMoneyField;
  etsyFees: CommerceMoneyField;
  netSales: CommerceMoneyField;
  warnings: string[];
};

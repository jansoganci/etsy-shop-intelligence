export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type EntityStatus = "MATCHED" | "MISMATCH" | "NOT_ENOUGH_DATA";

export type DateRange = { min: string | null; max: string | null };

export type EntityReconciliation = {
  apiCount: number;
  csvCount: number;
  matchedCount: number;
  apiOnlyCount: number;
  csvOnlyCount: number;
  status: EntityStatus;
  reason?: string;
  readiness: { api: boolean; csv: boolean };
  coverage: { api: DateRange; csv: DateRange; common: DateRange };
  outOfCoverageCount: { api: number; csv: number };
  cardinalityWarning: boolean;
  orphanCount?: { api: number | null; csv: number | null };
  /** Exact-ID-matched child records (transaction/payment) whose parent
   * (receipt_id/order_id) differs between API and CSV -- a real integrity
   * problem distinct from missing/orphan records, see plan §5.2. */
  parentMismatchCount?: number | null;
};

export type StubReconciliation = {
  status: "NOT_ENOUGH_DATA";
  reason: string;
};

// ---------------------------------------------------------------------------
// Pure logic (unit tested independently of D1).
// ---------------------------------------------------------------------------

/** Overlap of two [min, max] date ranges. Either side missing => no overlap. */
export function intersectRange(a: DateRange, b: DateRange): DateRange {
  if (!a.min || !a.max || !b.min || !b.max) return { min: null, max: null };
  const min = a.min > b.min ? a.min : b.min;
  const max = a.max < b.max ? a.max : b.max;
  if (min > max) return { min: null, max: null };
  return { min, max };
}

/** Never lets an out-of-range count exceed the only-count it was derived from. */
export function splitCoverage(
  onlyCount: number,
  outOfRangeCount: number,
): { inRange: number; outOfRange: number } {
  const outOfRange = Math.min(Math.max(0, outOfRangeCount), onlyCount);
  return { inRange: onlyCount - outOfRange, outOfRange };
}

export function detectCardinalityWarning(apiMatchedCount: number, csvMatchedCount: number): boolean {
  return apiMatchedCount !== csvMatchedCount;
}

/** Returns the count only when the resources it depends on are both ready; otherwise null (not misleading zero). */
export function resolveOrphanCount(ready: boolean, count: number): number | null {
  return ready ? count : null;
}

export function deriveEntityStatus(input: {
  apiReady: boolean;
  csvReady: boolean;
  apiCount: number;
  csvCount: number;
  apiOnlyInRangeCount: number;
  csvOnlyInRangeCount: number;
  commonRange: DateRange;
}): { status: EntityStatus; reason?: string } {
  if (!input.apiReady || !input.csvReady) {
    const reason =
      !input.apiReady && !input.csvReady
        ? "Neither the Etsy API sync nor the CSV import has completed for this source yet."
        : !input.apiReady
          ? "Etsy API sync for this source has not completed yet."
          : "CSV import for this source has not completed yet.";
    return { status: "NOT_ENOUGH_DATA", reason };
  }

  const bothHaveData = input.apiCount > 0 && input.csvCount > 0;
  if (bothHaveData && input.commonRange.min === null) {
    return {
      status: "NOT_ENOUGH_DATA",
      reason: "API and CSV cover non-overlapping date ranges; there is no shared window to compare yet.",
    };
  }

  if (input.apiOnlyInRangeCount === 0 && input.csvOnlyInRangeCount === 0) {
    return { status: "MATCHED" };
  }
  return { status: "MISMATCH" };
}

/**
 * Rolls up the three core, currently-comparable entities (orders, order items,
 * payments) into one status. Capability stubs (listings/refunds/reviews) are
 * intentionally excluded so they can never drag the overall result down to
 * NOT_ENOUGH_DATA on their own.
 */
export function deriveOverallStatus(coreStatuses: EntityStatus[]): EntityStatus {
  if (coreStatuses.includes("MISMATCH")) return "MISMATCH";
  if (coreStatuses.includes("NOT_ENOUGH_DATA")) return "NOT_ENOUGH_DATA";
  return "MATCHED";
}

// ---------------------------------------------------------------------------
// D1-backed data gathering.
// ---------------------------------------------------------------------------

export type ReadinessBundle = {
  apiSalesReady: boolean;
  apiFinanceReady: boolean;
  csvOrdersReady: boolean;
  csvOrderItemsReady: boolean;
  csvPaymentsReady: boolean;
  syncInProgress: boolean;
};

export async function loadReadiness(db: D1Database): Promise<ReadinessBundle> {
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT EXISTS(
            SELECT 1 FROM etsy_sync_job_resources WHERE resource = 'receipts' AND status = 'completed'
          ) OR EXISTS(
            SELECT 1 FROM etsy_sync_resources sr
            JOIN etsy_sync_runs run ON run.id = sr.run_id
            WHERE sr.resource = 'sales' AND sr.status = 'completed'
          )) AS api_sales_ready,
          (SELECT EXISTS(
            SELECT 1 FROM etsy_sync_job_resources
            WHERE resource IN ('payments', 'ledger_entries') AND status = 'completed'
          ) OR EXISTS(
            SELECT 1 FROM etsy_sync_resources sr
            JOIN etsy_sync_runs run ON run.id = sr.run_id
            WHERE sr.resource = 'finance' AND sr.status = 'completed'
          )) AS api_finance_ready,
          (SELECT EXISTS(
            SELECT 1 FROM imports WHERE import_type = 'orders' AND status = 'completed'
          )) AS csv_orders_ready,
          (SELECT EXISTS(
            SELECT 1 FROM imports WHERE import_type = 'order_items' AND status = 'completed'
          )) AS csv_order_items_ready,
          (SELECT EXISTS(
            SELECT 1 FROM imports WHERE import_type = 'payments' AND status = 'completed'
          )) AS csv_payments_ready,
          (SELECT EXISTS(
            SELECT 1 FROM etsy_sync_jobs
            WHERE (
              status IN ('queued', 'running', 'retry_wait', 'rate_limited')
              OR COALESCE(control_state, 'running') IN ('paused', 'cancelling')
            )
            AND status NOT IN ('completed', 'cancelled', 'failed')
          )) AS sync_in_progress
      `,
    )
    .first<Record<string, number>>();
  return {
    apiSalesReady: Boolean(row?.api_sales_ready),
    apiFinanceReady: Boolean(row?.api_finance_ready),
    csvOrdersReady: Boolean(row?.csv_orders_ready),
    csvOrderItemsReady: Boolean(row?.csv_order_items_ready),
    csvPaymentsReady: Boolean(row?.csv_payments_ready),
    syncInProgress: Boolean(row?.sync_in_progress),
  };
}

type CoreMetricsRow = {
  api_count: number;
  csv_count: number;
  api_matched_count: number;
  csv_matched_count: number;
  api_min: string | null;
  api_max: string | null;
  csv_min: string | null;
  csv_max: string | null;
};

type CoreMetrics = {
  apiCount: number;
  csvCount: number;
  apiMatchedCount: number;
  csvMatchedCount: number;
  apiRange: DateRange;
  csvRange: DateRange;
};

function toCoreMetrics(row: CoreMetricsRow | null): CoreMetrics {
  return {
    apiCount: Number(row?.api_count ?? 0),
    csvCount: Number(row?.csv_count ?? 0),
    apiMatchedCount: Number(row?.api_matched_count ?? 0),
    csvMatchedCount: Number(row?.csv_matched_count ?? 0),
    apiRange: { min: row?.api_min ?? null, max: row?.api_max ?? null },
    csvRange: { min: row?.csv_min ?? null, max: row?.csv_max ?? null },
  };
}

async function loadOrdersCore(db: D1Database): Promise<CoreMetrics> {
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_receipts) AS api_count,
          (SELECT COUNT(*) FROM orders) AS csv_count,
          (SELECT COUNT(*) FROM etsy_api_receipts api WHERE EXISTS (
            SELECT 1 FROM orders csv WHERE csv.order_id = api.receipt_id
          )) AS api_matched_count,
          (SELECT COUNT(*) FROM orders csv WHERE EXISTS (
            SELECT 1 FROM etsy_api_receipts api WHERE csv.order_id = api.receipt_id
          )) AS csv_matched_count,
          (SELECT MIN(date(create_timestamp, 'unixepoch')) FROM etsy_api_receipts) AS api_min,
          (SELECT MAX(date(create_timestamp, 'unixepoch')) FROM etsy_api_receipts) AS api_max,
          (SELECT MIN(sale_date) FROM v_orders_clean WHERE sale_date IS NOT NULL) AS csv_min,
          (SELECT MAX(sale_date) FROM v_orders_clean WHERE sale_date IS NOT NULL) AS csv_max
      `,
    )
    .first<CoreMetricsRow>();
  return toCoreMetrics(row);
}

async function loadOrdersOutOfRange(
  db: D1Database,
  common: DateRange,
): Promise<{ api: number; csv: number }> {
  if (!common.min || !common.max) return { api: 0, csv: 0 };
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_receipts api
            WHERE NOT EXISTS (SELECT 1 FROM orders csv WHERE csv.order_id = api.receipt_id)
              AND (date(api.create_timestamp, 'unixepoch') < ? OR date(api.create_timestamp, 'unixepoch') > ?)
          ) AS api_out,
          (SELECT COUNT(*) FROM orders csv
            JOIN v_orders_clean vc ON vc.order_id = csv.order_id
            WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts api WHERE csv.order_id = api.receipt_id)
              AND (vc.sale_date IS NULL OR vc.sale_date < ? OR vc.sale_date > ?)
          ) AS csv_out
      `,
    )
    .bind(common.min, common.max, common.min, common.max)
    .first<{ api_out: number; csv_out: number }>();
  return { api: Number(row?.api_out ?? 0), csv: Number(row?.csv_out ?? 0) };
}

async function loadOrderItemsCore(db: D1Database): Promise<CoreMetrics> {
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_transactions) AS api_count,
          (SELECT COUNT(*) FROM order_items) AS csv_count,
          (SELECT COUNT(*) FROM etsy_api_transactions api WHERE EXISTS (
            SELECT 1 FROM order_items csv WHERE csv.transaction_id = api.transaction_id
          )) AS api_matched_count,
          (SELECT COUNT(*) FROM order_items csv WHERE EXISTS (
            SELECT 1 FROM etsy_api_transactions api WHERE csv.transaction_id = api.transaction_id
          )) AS csv_matched_count,
          (SELECT MIN(date(create_timestamp, 'unixepoch')) FROM etsy_api_transactions) AS api_min,
          (SELECT MAX(date(create_timestamp, 'unixepoch')) FROM etsy_api_transactions) AS api_max,
          (SELECT MIN(sale_date) FROM v_order_items_clean WHERE sale_date IS NOT NULL) AS csv_min,
          (SELECT MAX(sale_date) FROM v_order_items_clean WHERE sale_date IS NOT NULL) AS csv_max
      `,
    )
    .first<CoreMetricsRow>();
  return toCoreMetrics(row);
}

async function loadOrderItemsOutOfRange(
  db: D1Database,
  common: DateRange,
): Promise<{ api: number; csv: number }> {
  if (!common.min || !common.max) return { api: 0, csv: 0 };
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_transactions api
            WHERE NOT EXISTS (SELECT 1 FROM order_items csv WHERE csv.transaction_id = api.transaction_id)
              AND (date(api.create_timestamp, 'unixepoch') < ? OR date(api.create_timestamp, 'unixepoch') > ?)
          ) AS api_out,
          (SELECT COUNT(*) FROM order_items csv
            JOIN v_order_items_clean vc ON vc.transaction_id = csv.transaction_id
            WHERE NOT EXISTS (
              SELECT 1 FROM etsy_api_transactions api WHERE csv.transaction_id = api.transaction_id
            )
              AND (vc.sale_date IS NULL OR vc.sale_date < ? OR vc.sale_date > ?)
          ) AS csv_out
      `,
    )
    .bind(common.min, common.max, common.min, common.max)
    .first<{ api_out: number; csv_out: number }>();
  return { api: Number(row?.api_out ?? 0), csv: Number(row?.csv_out ?? 0) };
}

async function loadOrderItemsParentMismatch(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM etsy_api_transactions api
        JOIN order_items csv ON csv.transaction_id = api.transaction_id
        WHERE csv.order_id <> api.receipt_id
      `,
    )
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function loadPaymentsParentMismatch(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM etsy_api_payments api
        JOIN payments csv ON csv.payment_id = api.payment_id
        WHERE csv.order_id <> api.receipt_id
      `,
    )
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function loadOrderItemsOrphans(db: D1Database): Promise<{ api: number; csv: number }> {
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_transactions t
            WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts r WHERE r.receipt_id = t.receipt_id)
          ) AS api_orphan,
          (SELECT COUNT(*) FROM order_items oi
            WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = oi.order_id)
          ) AS csv_orphan
      `,
    )
    .first<{ api_orphan: number; csv_orphan: number }>();
  return { api: Number(row?.api_orphan ?? 0), csv: Number(row?.csv_orphan ?? 0) };
}

async function loadPaymentsCore(db: D1Database): Promise<CoreMetrics> {
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_payments) AS api_count,
          (SELECT COUNT(*) FROM payments) AS csv_count,
          (SELECT COUNT(*) FROM etsy_api_payments api WHERE EXISTS (
            SELECT 1 FROM payments csv WHERE csv.payment_id = api.payment_id
          )) AS api_matched_count,
          (SELECT COUNT(*) FROM payments csv WHERE EXISTS (
            SELECT 1 FROM etsy_api_payments api WHERE csv.payment_id = api.payment_id
          )) AS csv_matched_count,
          (SELECT MIN(date(create_timestamp, 'unixepoch')) FROM etsy_api_payments) AS api_min,
          (SELECT MAX(date(create_timestamp, 'unixepoch')) FROM etsy_api_payments) AS api_max,
          (SELECT MIN(order_date) FROM v_payments_clean WHERE order_date IS NOT NULL) AS csv_min,
          (SELECT MAX(order_date) FROM v_payments_clean WHERE order_date IS NOT NULL) AS csv_max
      `,
    )
    .first<CoreMetricsRow>();
  return toCoreMetrics(row);
}

async function loadPaymentsOutOfRange(
  db: D1Database,
  common: DateRange,
): Promise<{ api: number; csv: number }> {
  if (!common.min || !common.max) return { api: 0, csv: 0 };
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_payments api
            WHERE NOT EXISTS (SELECT 1 FROM payments csv WHERE csv.payment_id = api.payment_id)
              AND (date(api.create_timestamp, 'unixepoch') < ? OR date(api.create_timestamp, 'unixepoch') > ?)
          ) AS api_out,
          (SELECT COUNT(*) FROM payments csv
            JOIN v_payments_clean vc ON vc.payment_id = csv.payment_id
            WHERE NOT EXISTS (
              SELECT 1 FROM etsy_api_payments api WHERE csv.payment_id = api.payment_id
            )
              AND (vc.order_date IS NULL OR vc.order_date < ? OR vc.order_date > ?)
          ) AS csv_out
      `,
    )
    .bind(common.min, common.max, common.min, common.max)
    .first<{ api_out: number; csv_out: number }>();
  return { api: Number(row?.api_out ?? 0), csv: Number(row?.csv_out ?? 0) };
}

async function loadPaymentsOrphans(db: D1Database): Promise<{ api: number; csv: number }> {
  const row = await db
    .prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM etsy_api_payments p
            WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts r WHERE r.receipt_id = p.receipt_id)
          ) AS api_orphan,
          (SELECT COUNT(*) FROM payments pay
            WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = pay.order_id)
          ) AS csv_orphan
      `,
    )
    .first<{ api_orphan: number; csv_orphan: number }>();
  return { api: Number(row?.api_orphan ?? 0), csv: Number(row?.csv_orphan ?? 0) };
}

/**
 * Exact-ID matches with a parent mismatch are not truly "matched" even when
 * the only-counts are both zero -- this is a real integrity problem (plan
 * §5.2), not something a healthy MATCHED status should hide.
 */
export function applyParentMismatchOverride(
  result: { status: EntityStatus; reason?: string },
  parentMismatchCount: number | null | undefined,
): { status: EntityStatus; reason?: string } {
  if (result.status !== "MATCHED" || !parentMismatchCount) return result;
  return {
    status: "MISMATCH",
    reason: `${parentMismatchCount} exact-ID-matched record(s) have a different parent (receipt/order) on each side.`,
  };
}

function assembleEntity(
  core: CoreMetrics,
  outOfRange: { api: number; csv: number },
  readiness: { api: boolean; csv: boolean },
  orphan?: { api: number | null; csv: number | null },
  parentMismatchCount?: number | null,
): EntityReconciliation {
  const apiOnlyCount = Math.max(0, core.apiCount - core.apiMatchedCount);
  const csvOnlyCount = Math.max(0, core.csvCount - core.csvMatchedCount);
  const commonRange = intersectRange(core.apiRange, core.csvRange);
  const apiSplit = splitCoverage(apiOnlyCount, outOfRange.api);
  const csvSplit = splitCoverage(csvOnlyCount, outOfRange.csv);

  const { status, reason } = applyParentMismatchOverride(
    deriveEntityStatus({
      apiReady: readiness.api,
      csvReady: readiness.csv,
      apiCount: core.apiCount,
      csvCount: core.csvCount,
      apiOnlyInRangeCount: apiSplit.inRange,
      csvOnlyInRangeCount: csvSplit.inRange,
      commonRange,
    }),
    parentMismatchCount,
  );

  return {
    apiCount: core.apiCount,
    csvCount: core.csvCount,
    matchedCount: Math.min(core.apiMatchedCount, core.csvMatchedCount),
    apiOnlyCount,
    csvOnlyCount,
    status,
    ...(reason ? { reason } : {}),
    readiness,
    coverage: { api: core.apiRange, csv: core.csvRange, common: commonRange },
    outOfCoverageCount: { api: apiSplit.outOfRange, csv: csvSplit.outOfRange },
    cardinalityWarning: detectCardinalityWarning(core.apiMatchedCount, core.csvMatchedCount),
    ...(orphan ? { orphanCount: orphan } : {}),
    ...(parentMismatchCount !== undefined ? { parentMismatchCount } : {}),
  };
}

export type ReconciliationResult = {
  orders: EntityReconciliation;
  orderItems: EntityReconciliation;
  payments: EntityReconciliation;
  listings: StubReconciliation;
  refunds: StubReconciliation;
  reviews: StubReconciliation;
  overallStatus: EntityStatus;
  calculatedAt: string;
  syncInProgress: boolean;
};

export async function loadReconciliation(db: D1Database): Promise<ReconciliationResult> {
  const [
    readiness,
    ordersCore,
    orderItemsCore,
    paymentsCore,
    orderItemsOrphans,
    paymentsOrphans,
    orderItemsParentMismatch,
    paymentsParentMismatch,
  ] = await Promise.all([
    loadReadiness(db),
    loadOrdersCore(db),
    loadOrderItemsCore(db),
    loadPaymentsCore(db),
    loadOrderItemsOrphans(db),
    loadPaymentsOrphans(db),
    loadOrderItemsParentMismatch(db),
    loadPaymentsParentMismatch(db),
  ]);

  const ordersCommon = intersectRange(ordersCore.apiRange, ordersCore.csvRange);
  const orderItemsCommon = intersectRange(orderItemsCore.apiRange, orderItemsCore.csvRange);
  const paymentsCommon = intersectRange(paymentsCore.apiRange, paymentsCore.csvRange);

  const [ordersOutOfRange, orderItemsOutOfRange, paymentsOutOfRange] = await Promise.all([
    loadOrdersOutOfRange(db, ordersCommon),
    loadOrderItemsOutOfRange(db, orderItemsCommon),
    loadPaymentsOutOfRange(db, paymentsCommon),
  ]);

  const orders = assembleEntity(ordersCore, ordersOutOfRange, {
    api: readiness.apiSalesReady,
    csv: readiness.csvOrdersReady,
  });
  const orderItems = assembleEntity(
    orderItemsCore,
    orderItemsOutOfRange,
    { api: readiness.apiSalesReady, csv: readiness.csvOrderItemsReady },
    {
      api: resolveOrphanCount(readiness.apiSalesReady, orderItemsOrphans.api),
      csv: resolveOrphanCount(
        readiness.csvOrdersReady && readiness.csvOrderItemsReady,
        orderItemsOrphans.csv,
      ),
    },
    resolveOrphanCount(
      readiness.apiSalesReady && readiness.csvOrdersReady && readiness.csvOrderItemsReady,
      orderItemsParentMismatch,
    ),
  );
  const payments = assembleEntity(
    paymentsCore,
    paymentsOutOfRange,
    { api: readiness.apiFinanceReady, csv: readiness.csvPaymentsReady },
    {
      api: resolveOrphanCount(
        readiness.apiFinanceReady && readiness.apiSalesReady,
        paymentsOrphans.api,
      ),
      csv: resolveOrphanCount(readiness.csvPaymentsReady && readiness.csvOrdersReady, paymentsOrphans.csv),
    },
    resolveOrphanCount(
      readiness.apiFinanceReady && readiness.csvPaymentsReady && readiness.csvOrdersReady,
      paymentsParentMismatch,
    ),
  );

  const overallStatus = deriveOverallStatus([orders.status, orderItems.status, payments.status]);

  return {
    orders,
    orderItems,
    payments,
    listings: {
      status: "NOT_ENOUGH_DATA",
      reason: "No CSV listing source table exists yet; only Etsy API listing data is available.",
    },
    refunds: {
      status: "NOT_ENOUGH_DATA",
      // Refund $ amounts ARE compared (monthlyFinancials "refund" metric, via
      // migration 0013's etsy_api_payment_adjustments/etsy_api_receipt_refunds).
      // What's still missing is a record-level refund entity here -- CSV has
      // no per-refund identity to match against (only an aggregate
      // refund_amount per payment), so entity-level reconciliation status
      // stays NOT_ENOUGH_DATA even though the monthly total is not.
      reason:
        "Refund totals are compared monthly (see monthlyFinancials), but there is no per-refund CSV identity yet for a record-level match here.",
    },
    reviews: {
      status: "NOT_ENOUGH_DATA",
      reason: "No CSV review source exists; reviews can only be compared against manual monthly stats in a later phase.",
    },
    overallStatus,
    calculatedAt: new Date().toISOString(),
    syncInProgress: readiness.syncInProgress,
  };
}

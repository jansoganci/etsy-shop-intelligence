import { detectDateBoundaryShifts } from "../../../../functions/api/data-center/_dateBoundary";
import {
  loadMonthlyFinancials,
  type FinancialMetric,
} from "../../../../functions/api/data-center/_financialReconciliation";
import {
  loadAllIssuesForExport,
  type IssueEntity,
  type IssueRecord,
  type IssueType,
} from "../../../../functions/api/data-center/_issues";
import {
  loadReconciliation,
  type ReconciliationResult,
} from "../../../../functions/api/data-center/_reconciliation";
import { newId } from "../engine/repository";
import type { Env } from "../types";

export const RECONCILIATION_RULES_VERSION = "2026-07-26.v1";
export const REPORTING_TIMEZONE = "Europe/Istanbul";

export type ReconciliationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ReconciliationQueueMessage = {
  kind: "reconciliation";
  runId: string;
};

type ReconciliationRunRow = {
  id: string;
  shop_id: string;
  status: ReconciliationRunStatus;
  trigger_type: "manual" | "sync_generation";
  reporting_timezone: string;
  rules_version: string;
  api_sync_run_id: string | null;
  csv_import_watermark: string | null;
  progress_total: number;
  progress_completed: number;
  current_step: string | null;
  error_code: string | null;
  error_message: string | null;
  summary_json: string | null;
  shadow_json: string | null;
  source_snapshot_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

type RunSummary = ReconciliationResult & {
  monthlyFinancials: Awaited<ReturnType<typeof loadMonthlyFinancials>>;
  dateBoundary: Awaited<ReturnType<typeof detectDateBoundaryShifts>>;
};

type RunIssue = {
  entity: IssueEntity;
  type: IssueType | "financial_difference";
  record: IssueRecord;
  fieldName?: string;
  apiValue?: number | null;
  csvValue?: number | null;
  difference?: number | null;
  status?: "WARNING" | "MISMATCH" | "BLOCKING";
  reasonCode?: string;
  severity?: "warning" | "error" | "critical";
};

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
  summary: RunSummary | null;
  shadow: Record<string, unknown> | null;
  sourceSnapshot: SourceSnapshot | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

function mapRun(row: ReconciliationRunRow): ReconciliationRun {
  return {
    id: row.id,
    shopId: row.shop_id,
    status: row.status,
    triggerType: row.trigger_type,
    reportingTimezone: row.reporting_timezone,
    rulesVersion: row.rules_version,
    apiSyncRunId: row.api_sync_run_id,
    csvImportWatermark: row.csv_import_watermark,
    progress: {
      completed: Number(row.progress_completed),
      total: Number(row.progress_total),
      currentStep: row.current_step,
    },
    errorCode: row.error_code,
    errorMessage: row.error_message,
    summary: row.summary_json ? JSON.parse(row.summary_json) as RunSummary : null,
    shadow: row.shadow_json ? JSON.parse(row.shadow_json) as Record<string, unknown> : null,
    sourceSnapshot: row.source_snapshot_json
      ? JSON.parse(row.source_snapshot_json) as SourceSnapshot
      : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  };
}

export type SourceSnapshot = {
  salesSyncRunId: string | null;
  financeSyncRunId: string | null;
  apiReceiptsVersion: string | null;
  apiTransactionsVersion: string | null;
  apiPaymentsVersion: string | null;
  apiAdjustmentsVersion: string | null;
  apiRefundsVersion: string | null;
  csvOrdersVersion: string;
  csvItemsVersion: string;
  csvPaymentsVersion: string;
};

export type SourceBusyState = { etsySync: boolean; csvImport: boolean };

type SourceStateRow = SourceBusyState & SourceSnapshot;

function sourceSnapshotOf(row: SourceStateRow): SourceSnapshot {
  const {
    etsySync: _etsySync,
    csvImport: _csvImport,
    ...snapshot
  } = row;
  return snapshot;
}

export async function loadSourceState(env: Env, shopId: string): Promise<SourceStateRow> {
  const row = await env.DB.prepare(
    `
      SELECT
        EXISTS(
          SELECT 1 FROM etsy_sync_jobs
          WHERE shop_id=? AND status NOT IN ('completed','cancelled','failed')
            AND (
              status IN ('queued','running','retry_wait','rate_limited','partial')
              OR COALESCE(control_state, 'running') IN ('paused','cancelling')
            )
        ) AS etsySync,
        EXISTS(
          SELECT 1 FROM imports WHERE status IN ('pending','importing','processing')
        ) AS csvImport,
        (
          SELECT job.id FROM etsy_sync_job_resources resource
          JOIN etsy_sync_jobs job ON job.id=resource.run_id
          WHERE job.shop_id=? AND resource.resource='receipts'
            AND resource.status='completed'
          ORDER BY job.completed_at DESC LIMIT 1
        ) AS salesSyncRunId,
        (
          SELECT job.id FROM etsy_sync_job_resources resource
          JOIN etsy_sync_jobs job ON job.id=resource.run_id
          WHERE job.shop_id=? AND resource.resource IN ('payments','ledger_entries')
            AND resource.status='completed'
          ORDER BY job.completed_at DESC LIMIT 1
        ) AS financeSyncRunId,
        (SELECT MAX(synced_at) FROM etsy_api_receipts) AS apiReceiptsVersion,
        (SELECT MAX(synced_at) FROM etsy_api_transactions) AS apiTransactionsVersion,
        (SELECT MAX(synced_at) FROM etsy_api_payments) AS apiPaymentsVersion,
        (SELECT MAX(synced_at) FROM etsy_api_payment_adjustments) AS apiAdjustmentsVersion,
        (SELECT MAX(synced_at) FROM etsy_api_receipt_refunds) AS apiRefundsVersion,
        (
          SELECT printf('%d:%d:%s', COALESCE(MAX(import_id),0), COUNT(*), COALESCE(MAX(updated_at),''))
          FROM orders
        ) AS csvOrdersVersion,
        (
          SELECT printf('%d:%d:%s', COALESCE(MAX(import_id),0), COUNT(*), COALESCE(MAX(updated_at),''))
          FROM order_items
        ) AS csvItemsVersion,
        (
          SELECT printf('%d:%d:%s', COALESCE(MAX(import_id),0), COUNT(*), COALESCE(MAX(updated_at),''))
          FROM payments
        ) AS csvPaymentsVersion
    `,
  )
    .bind(shopId, shopId, shopId)
    .first<Record<string, unknown>>();
  return {
    etsySync: Boolean(row?.etsySync),
    csvImport: Boolean(row?.csvImport),
    salesSyncRunId: String(row?.salesSyncRunId ?? "") || null,
    financeSyncRunId: String(row?.financeSyncRunId ?? "") || null,
    apiReceiptsVersion: String(row?.apiReceiptsVersion ?? "") || null,
    apiTransactionsVersion: String(row?.apiTransactionsVersion ?? "") || null,
    apiPaymentsVersion: String(row?.apiPaymentsVersion ?? "") || null,
    apiAdjustmentsVersion: String(row?.apiAdjustmentsVersion ?? "") || null,
    apiRefundsVersion: String(row?.apiRefundsVersion ?? "") || null,
    csvOrdersVersion: String(row?.csvOrdersVersion ?? "0:0:"),
    csvItemsVersion: String(row?.csvItemsVersion ?? "0:0:"),
    csvPaymentsVersion: String(row?.csvPaymentsVersion ?? "0:0:"),
  };
}

export class ReconciliationSourceBusyError extends Error {
  constructor(readonly busy: SourceBusyState) {
    super("reconciliation_source_busy");
  }
}

async function connectedShopId(env: Env): Promise<string | null> {
  const row = await env.DB
    .prepare(
      "SELECT shop_id FROM etsy_connections WHERE status='connected' ORDER BY connected_at DESC LIMIT 1",
    )
    .first<{ shop_id: string }>();
  return row?.shop_id ?? null;
}

async function enqueueRun(env: Env, runId: string): Promise<void> {
  await env.DB
    .prepare(
      `
        INSERT INTO etsy_reconciliation_outbox (
          id, dispatch_key, reconciliation_run_id, status
        ) VALUES (?, ?, ?, 'pending')
        ON CONFLICT(dispatch_key) DO NOTHING
      `,
    )
    .bind(newId(), `reconciliation:${runId}:initial`, runId)
    .run();
}

export async function createManualReconciliationRun(env: Env): Promise<ReconciliationRun | null> {
  const shopId = await connectedShopId(env);
  if (!shopId) return null;
  const active = await env.DB
    .prepare(
      `
        SELECT * FROM etsy_reconciliation_runs
        WHERE shop_id=? AND status IN ('queued','running')
        ORDER BY created_at DESC LIMIT 1
      `,
    )
    .bind(shopId)
    .first<ReconciliationRunRow>();
  if (active) {
    await dispatchReconciliationOutbox(env);
    return mapRun(active);
  }

  const sourceState = await loadSourceState(env, shopId);
  if (sourceState.etsySync || sourceState.csvImport) {
    throw new ReconciliationSourceBusyError({
      etsySync: sourceState.etsySync,
      csvImport: sourceState.csvImport,
    });
  }
  const snapshot = sourceSnapshotOf(sourceState);
  const runId = newId();
  await env.DB.batch([
    env.DB
      .prepare(
        `
          INSERT INTO etsy_reconciliation_runs (
            id, shop_id, status, trigger_type, reporting_timezone, rules_version,
            api_sync_run_id, csv_import_watermark, source_snapshot_json, current_step
          ) VALUES (?, ?, 'queued', 'manual', ?, ?, ?, ?, ?, 'Bekliyor')
        `,
      )
      .bind(
        runId,
        shopId,
        REPORTING_TIMEZONE,
        RECONCILIATION_RULES_VERSION,
        snapshot.financeSyncRunId ?? snapshot.salesSyncRunId,
        [
          snapshot.csvOrdersVersion,
          snapshot.csvItemsVersion,
          snapshot.csvPaymentsVersion,
        ].join("|"),
        JSON.stringify(snapshot),
      ),
    env.DB
      .prepare(
        `
          INSERT INTO etsy_reconciliation_outbox (
            id, dispatch_key, reconciliation_run_id, status
          ) VALUES (?, ?, ?, 'pending')
        `,
      )
      .bind(newId(), `reconciliation:${runId}:initial`, runId),
  ]);
  await dispatchReconciliationOutbox(env);
  const created = await getReconciliationRun(env, runId);
  return created;
}

export async function getReconciliationRun(
  env: Env,
  runId: string,
): Promise<ReconciliationRun | null> {
  const row = await env.DB
    .prepare("SELECT * FROM etsy_reconciliation_runs WHERE id=?")
    .bind(runId)
    .first<ReconciliationRunRow>();
  return row ? mapRun(row) : null;
}

export async function listReconciliationRuns(
  env: Env,
  limit = 20,
): Promise<ReconciliationRun[]> {
  const shopId = await connectedShopId(env);
  if (!shopId) return [];
  const rows = await env.DB
    .prepare(
      `
        SELECT * FROM etsy_reconciliation_runs
        WHERE shop_id=? ORDER BY created_at DESC LIMIT ?
      `,
    )
    .bind(shopId, Math.min(50, Math.max(1, Math.floor(limit))))
    .all<ReconciliationRunRow>();
  return (rows.results ?? []).map(mapRun);
}

export async function cancelReconciliationRun(env: Env, runId: string): Promise<boolean> {
  const result = await env.DB
    .prepare(
      `
        UPDATE etsy_reconciliation_runs SET
          status='cancelled', current_step='İptal edildi',
          cancelled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN ('queued','running')
      `,
    )
    .bind(runId)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function claimRun(env: Env, runId: string, now: Date): Promise<{ run: ReconciliationRunRow; leaseToken: string } | null> {
  const leaseToken = newId();
  const leaseExpiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const result = await env.DB
    .prepare(
      `
        UPDATE etsy_reconciliation_runs SET
          status='running', current_step='Özet hesaplanıyor',
          lease_token=?, lease_expires_at=?, started_at=COALESCE(started_at, CURRENT_TIMESTAMP),
          updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND (
          status='queued'
          OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
        )
      `,
    )
    .bind(leaseToken, leaseExpiresAt, runId, now.toISOString())
    .run();
  if (!result.meta?.changes) return null;
  const run = await env.DB
    .prepare("SELECT * FROM etsy_reconciliation_runs WHERE id=? AND lease_token=?")
    .bind(runId, leaseToken)
    .first<ReconciliationRunRow>();
  return run ? { run, leaseToken } : null;
}

async function updateProgress(
  env: Env,
  runId: string,
  leaseToken: string,
  completed: number,
  step: string,
): Promise<boolean> {
  const result = await env.DB
    .prepare(
      `
        UPDATE etsy_reconciliation_runs SET
          progress_completed=?, current_step=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='running' AND lease_token=?
      `,
    )
    .bind(completed, step, runId, leaseToken)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export function severityForIssue(type: IssueType): "error" | "critical" {
  return type === "parent_mismatch" ? "critical" : "error";
}

export function reasonCodeForIssue(type: IssueType): string {
  return {
    missing_in_api: "MISSING_IN_API",
    missing_in_csv: "MISSING_IN_CSV",
    orphan_api: "ORPHAN_API_RECORD",
    orphan_csv: "ORPHAN_CSV_RECORD",
    parent_mismatch: "PARENT_ID_MISMATCH",
  }[type];
}

export function severityForMetric(metric: FinancialMetric): "info" | "warning" | "error" {
  if (metric.status === "MISMATCH") return "error";
  if (metric.status === "WARNING") return "warning";
  return "info";
}

export function reasonCodeForMetric(metric: FinancialMetric): string {
  if (metric.status === "MATCHED") return "EXACT_MATCH";
  if (metric.status === "WARNING") return "WITHIN_TOLERANCE";
  if (metric.status === "MISMATCH") return "AMOUNT_MISMATCH";
  if (metric.reason?.includes("Currency")) return "CURRENCY_UNAVAILABLE";
  return "NOT_ENOUGH_DATA";
}

function issueRequests(summary: RunSummary): Array<{ entity: IssueEntity; type: IssueType }> {
  const requests: Array<{ entity: IssueEntity; type: IssueType }> = [
    { entity: "orders", type: "missing_in_api" },
    { entity: "orders", type: "missing_in_csv" },
  ];
  for (const entity of ["orderItems", "payments"] as const) {
    requests.push(
      { entity, type: "missing_in_api" },
      { entity, type: "missing_in_csv" },
      { entity, type: "orphan_api" },
      { entity, type: "orphan_csv" },
      { entity, type: "parent_mismatch" },
    );
  }
  return requests.filter(({ entity }) => {
    const reconciliation = summary[entity];
    return reconciliation.coverage.common.min !== null && reconciliation.coverage.common.max !== null;
  });
}

async function loadRunIssues(env: Env, summary: RunSummary): Promise<RunIssue[]> {
  const pages = await Promise.all(
    issueRequests(summary).map(async ({ entity, type }) => {
      const range = summary[entity].coverage.common;
      const records = await loadAllIssuesForExport(env.DB as never, entity, type, range);
      return records.map((record) => ({ entity, type, record }));
    }),
  );
  return pages.flat();
}

const ENTITY_TOLERANCE_USD = 0.02;

type FinancialPair = {
  id: string;
  date: string | null;
  api_currency: string | null;
  csv_currency: string | null;
  csv_listing_currency?: string | null;
  csv_exchange_rate?: number | null;
  [key: string]: string | number | null | undefined;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toUsd(
  value: number | null,
  currency: string | null,
  listingCurrency?: string | null,
  exchangeRate?: number | null,
): number | null {
  const normalized = currency?.trim().toUpperCase();
  if (value === null) return null;
  if (normalized === "USD") return value;
  if (
    normalized === "TRY"
    && listingCurrency?.trim().toUpperCase() === "USD"
    && typeof exchangeRate === "number"
    && exchangeRate > 0
  ) {
    return value / exchangeRate;
  }
  return null;
}

export function financialIssue(
  entity: "orders" | "payments",
  row: FinancialPair,
  fieldName: string,
  apiNative: number | null,
  csvNative: number | null,
): RunIssue | null {
  if (apiNative === null && csvNative === null) return null;
  if (apiNative === null || csvNative === null) {
    return {
      entity,
      type: "financial_difference",
      record: {
        id: row.id,
        date: row.date,
        amount: apiNative ?? csvNative,
        currency: "USD",
        detail: `${fieldName}: one source has no value`,
      },
      fieldName,
      apiValue: apiNative,
      csvValue: csvNative,
      difference: null,
      status: "BLOCKING",
      reasonCode: "BUSINESS_BASIS_MISSING",
      severity: "critical",
    };
  }
  const apiValue = toUsd(apiNative, row.api_currency);
  const csvValue = toUsd(
    csvNative,
    row.csv_currency,
    row.csv_listing_currency,
    numberOrNull(row.csv_exchange_rate),
  );
  if (apiValue === null || csvValue === null) {
    return {
      entity,
      type: "financial_difference",
      record: {
        id: row.id,
        date: row.date,
        amount: apiValue ?? csvValue,
        currency: "USD",
        detail: `${fieldName}: currency conversion unavailable`,
      },
      fieldName,
      apiValue,
      csvValue,
      difference: null,
      status: "BLOCKING",
      reasonCode: "EXCHANGE_RATE_MISSING",
      severity: "critical",
    };
  }
  const difference = apiValue - csvValue;
  if (difference === 0) return null;
  const warning = Math.abs(difference) <= ENTITY_TOLERANCE_USD;
  return {
    entity,
    type: "financial_difference",
    record: {
      id: row.id,
      date: row.date,
      amount: difference,
      currency: "USD",
      detail: fieldName,
    },
    fieldName,
    apiValue,
    csvValue,
    difference,
    status: warning ? "WARNING" : "MISMATCH",
    reasonCode: warning ? "ROUNDING_WITHIN_TOLERANCE" : "AMOUNT_MISMATCH",
    severity: warning ? "warning" : "error",
  };
}

async function loadEntityFinancialIssues(env: Env): Promise<RunIssue[]> {
  const [orderResult, paymentResult] = await Promise.all([
    env.DB.prepare(
      `
        SELECT api.receipt_id AS id, csv.sale_date AS date,
          api.total_price_currency AS api_currency, csv.currency AS csv_currency,
          CASE WHEN api.total_price_divisor>0 THEN api.total_price_amount*1.0/api.total_price_divisor END
            - COALESCE(CASE WHEN api.discount_amt_divisor>0 THEN api.discount_amt_amount*1.0/api.discount_amt_divisor END,0) AS api_gross,
          csv.order_value-COALESCE(csv.discount_amount,0) AS csv_gross,
          CASE WHEN api.discount_amt_divisor>0 THEN api.discount_amt_amount*1.0/api.discount_amt_divisor END AS api_discount,
          csv.discount_amount AS csv_discount,
          CASE WHEN api.total_shipping_cost_divisor>0 THEN api.total_shipping_cost_amount*1.0/api.total_shipping_cost_divisor END AS api_shipping,
          csv.shipping AS csv_shipping,
          CASE WHEN api.total_tax_cost_divisor>0 THEN api.total_tax_cost_amount*1.0/api.total_tax_cost_divisor END AS api_tax,
          csv.sales_tax AS csv_tax,
          CASE WHEN api.grandtotal_divisor>0 THEN api.grandtotal_amount*1.0/api.grandtotal_divisor END AS api_total,
          csv.order_total AS csv_total
        FROM etsy_api_receipts api JOIN orders csv ON csv.order_id=api.receipt_id
      `,
    ).all<FinancialPair>(),
    env.DB.prepare(
      `
        SELECT api.payment_id AS id, csv.order_date AS date,
          COALESCE(api.currency,api.amount_gross_currency) AS api_currency,
          csv.currency AS csv_currency, csv.listing_currency AS csv_listing_currency,
          csv.exchange_rate AS csv_exchange_rate,
          CASE WHEN api.amount_gross_divisor>0 THEN api.amount_gross*1.0/api.amount_gross_divisor END AS api_gross,
          csv.gross_amount AS csv_gross,
          CASE WHEN api.amount_fees_divisor>0 THEN api.amount_fees*1.0/api.amount_fees_divisor END AS api_fees,
          csv.fees AS csv_fees,
          CASE WHEN api.amount_net_divisor>0 THEN api.amount_net*1.0/api.amount_net_divisor END AS api_net,
          csv.net_amount AS csv_net,
          CASE WHEN api.posted_gross_divisor>0 THEN api.posted_gross*1.0/api.posted_gross_divisor END AS api_posted_gross,
          csv.posted_gross AS csv_posted_gross,
          CASE WHEN api.posted_fees_divisor>0 THEN api.posted_fees*1.0/api.posted_fees_divisor END AS api_posted_fees,
          csv.posted_fees AS csv_posted_fees,
          CASE WHEN api.posted_net_divisor>0 THEN api.posted_net*1.0/api.posted_net_divisor END AS api_posted_net,
          csv.posted_net AS csv_posted_net,
          CASE WHEN api.adjusted_gross_divisor>0 THEN api.adjusted_gross*1.0/api.adjusted_gross_divisor END AS api_adjusted_gross,
          csv.adjusted_gross AS csv_adjusted_gross,
          CASE WHEN api.adjusted_fees_divisor>0 THEN api.adjusted_fees*1.0/api.adjusted_fees_divisor END AS api_adjusted_fees,
          csv.adjusted_fees AS csv_adjusted_fees,
          CASE WHEN api.adjusted_net_divisor>0 THEN api.adjusted_net*1.0/api.adjusted_net_divisor END AS api_adjusted_net,
          csv.adjusted_net AS csv_adjusted_net,
          COALESCE((
            SELECT SUM(adj.total_adjustment_amount)*1.0/100
            FROM etsy_api_payment_adjustments adj
            WHERE adj.payment_id=api.payment_id AND adj.is_success=1
          ),0) AS api_refund,
          COALESCE(csv.refund_amount,0) AS csv_refund
        FROM etsy_api_payments api JOIN payments csv ON csv.payment_id=api.payment_id
      `,
    ).all<FinancialPair>(),
  ]);
  const issues: RunIssue[] = [];
  const orderFields = [
    ["grossSales", "api_gross", "csv_gross"],
    ["discount", "api_discount", "csv_discount"],
    ["shipping", "api_shipping", "csv_shipping"],
    ["tax", "api_tax", "csv_tax"],
    ["orderTotal", "api_total", "csv_total"],
  ] as const;
  for (const row of orderResult.results ?? []) {
    for (const [field, apiKey, csvKey] of orderFields) {
      const issue = financialIssue("orders", row, field, numberOrNull(row[apiKey]), numberOrNull(row[csvKey]));
      if (issue) issues.push(issue);
    }
  }
  const paymentFields = [
    ["grossOriginal", "api_gross", "csv_gross"],
    ["feeOriginal", "api_fees", "csv_fees"],
    ["netOriginal", "api_net", "csv_net"],
    ["grossPosted", "api_posted_gross", "csv_posted_gross"],
    ["feePosted", "api_posted_fees", "csv_posted_fees"],
    ["netPosted", "api_posted_net", "csv_posted_net"],
    ["grossAdjusted", "api_adjusted_gross", "csv_adjusted_gross"],
    ["feeAdjusted", "api_adjusted_fees", "csv_adjusted_fees"],
    ["netAdjusted", "api_adjusted_net", "csv_adjusted_net"],
    ["refund", "api_refund", "csv_refund"],
  ] as const;
  for (const row of paymentResult.results ?? []) {
    for (const [field, apiKey, csvKey] of paymentFields) {
      const issue = financialIssue("payments", row, field, numberOrNull(row[apiKey]), numberOrNull(row[csvKey]));
      if (issue) issues.push(issue);
    }
  }
  return issues;
}

async function persistMetrics(
  env: Env,
  runId: string,
  summary: RunSummary,
): Promise<void> {
  const statements = summary.monthlyFinancials.months.flatMap((month) =>
    month.metrics.map((metric) =>
      env.DB
        .prepare(
          `
            INSERT INTO etsy_reconciliation_metric_results (
              id, reconciliation_run_id, grain, period_key, entity, metric_key,
              api_value, csv_value, currency, difference, status, severity, reason_code
            ) VALUES (?, ?, 'monthly', ?, 'financial', ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          newId(),
          runId,
          month.month,
          metric.key,
          metric.apiValue,
          metric.csvValue,
          metric.currency,
          metric.difference,
          metric.status,
          severityForMetric(metric),
          reasonCodeForMetric(metric),
        ),
    ),
  );
  if (statements.length > 0) await env.DB.batch(statements);
}

async function persistIssues(env: Env, runId: string, issues: RunIssue[]): Promise<void> {
  const statements = issues.map((issue) =>
    env.DB
      .prepare(
        `
          INSERT INTO etsy_reconciliation_issues (
            id, reconciliation_run_id, entity, issue_type, severity, reason_code,
            source_record_id, entity_record_id, record_date, amount, currency, detail,
            status, field_name, api_value, csv_value, difference,
            match_method, match_confidence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'exact_id', 1)
        `,
      )
      .bind(
        newId(),
        runId,
        issue.entity,
        issue.type,
        issue.severity ?? severityForIssue(issue.type as IssueType),
        issue.reasonCode ?? reasonCodeForIssue(issue.type as IssueType),
        issue.fieldName ? `${issue.record.id}:${issue.fieldName}` : issue.record.id,
        issue.record.id,
        issue.record.date,
        issue.record.amount,
        issue.record.currency,
        issue.record.detail ?? null,
        issue.status ?? "MISMATCH",
        issue.fieldName ?? null,
        issue.apiValue ?? null,
        issue.csvValue ?? null,
        issue.difference ?? null,
      ),
  );
  if (statements.length > 0) await env.DB.batch(statements);
}

async function loadShadowComparison(env: Env, summary: RunSummary): Promise<Record<string, unknown>> {
  const legacy = await env.DB
    .prepare(
      `
        SELECT run_id, result_json FROM etsy_reconciliation_generations
        WHERE status='completed' AND result_json IS NOT NULL
        ORDER BY calculated_at DESC LIMIT 1
      `,
    )
    .first<{ run_id: string; result_json: string }>();
  if (!legacy) return { status: "no_legacy_generation" };
  const result = JSON.parse(legacy.result_json) as Partial<ReconciliationResult>;
  const entities = ["orders", "orderItems", "payments"] as const;
  const differences = entities.filter((entity) => {
    const before = result[entity];
    const after = summary[entity];
    return !before ||
      before.apiCount !== after.apiCount ||
      before.csvCount !== after.csvCount ||
      before.matchedCount !== after.matchedCount ||
      before.status !== after.status;
  });
  return {
    status: differences.length === 0 ? "match" : "different",
    legacyGenerationRunId: legacy.run_id,
    differingEntities: differences,
  };
}

export async function executeReconciliationRun(
  env: Env,
  message: ReconciliationQueueMessage,
  now = new Date(),
): Promise<void> {
  const claimed = await claimRun(env, message.runId, now);
  if (!claimed) return;
  const { run, leaseToken } = claimed;
  try {
    const expectedSnapshot = run.source_snapshot_json
      ? JSON.parse(run.source_snapshot_json) as SourceSnapshot
      : null;
    const beforeState = await loadSourceState(env, run.shop_id);
    if (
      !expectedSnapshot
      || beforeState.etsySync
      || beforeState.csvImport
      || JSON.stringify(sourceSnapshotOf(beforeState)) !== JSON.stringify(expectedSnapshot)
    ) {
      await failSourceChangedRun(env, run.id, leaseToken);
      return;
    }
    const reconciliation = await loadReconciliation(env.DB as never);
    const [monthlyFinancials, dateBoundary] = await Promise.all([
      loadMonthlyFinancials(env.DB as never, reconciliation.orders, reconciliation.payments),
      detectDateBoundaryShifts(env.DB as never, reconciliation.orders, reconciliation.payments),
    ]);
    const summary: RunSummary = { ...reconciliation, monthlyFinancials, dateBoundary };
    if (!await updateProgress(env, run.id, leaseToken, 1, "Metrikler kaydediliyor")) return;

    await persistMetrics(env, run.id, summary);
    if (!await updateProgress(env, run.id, leaseToken, 2, "Issue kayıtları hazırlanıyor")) return;

    const [recordIssues, financialIssues] = await Promise.all([
      loadRunIssues(env, summary),
      loadEntityFinancialIssues(env),
    ]);
    const issues = [...recordIssues, ...financialIssues];
    await persistIssues(env, run.id, issues);
    if (!await updateProgress(env, run.id, leaseToken, 3, "Shadow karşılaştırması yapılıyor")) return;

    const shadow = await loadShadowComparison(env, summary);
    const afterState = await loadSourceState(env, run.shop_id);
    if (
      afterState.etsySync
      || afterState.csvImport
      || JSON.stringify(sourceSnapshotOf(afterState)) !== JSON.stringify(expectedSnapshot)
    ) {
      await failSourceChangedRun(env, run.id, leaseToken);
      return;
    }
    await env.DB
      .prepare(
        `
          UPDATE etsy_reconciliation_runs SET
            status='completed', progress_completed=progress_total, current_step='Tamamlandı',
            summary_json=?, shadow_json=?, completed_at=CURRENT_TIMESTAMP,
            lease_token=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='running' AND lease_token=?
        `,
      )
      .bind(JSON.stringify(summary), JSON.stringify(shadow), run.id, leaseToken)
      .run();
  } catch (error) {
    await env.DB
      .prepare(
        `
          UPDATE etsy_reconciliation_runs SET
            status='failed', current_step='Başarısız',
            error_code='reconciliation_run_failed', error_message=?,
            lease_token=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='running' AND lease_token=?
        `,
      )
      .bind(error instanceof Error ? error.message : "Unknown reconciliation error.", run.id, leaseToken)
      .run();
    throw error;
  }
}

async function failSourceChangedRun(env: Env, runId: string, leaseToken: string): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE etsy_reconciliation_runs SET
        status='failed', current_step='Kaynak veri değişti',
        error_code='source_changed_during_run',
        error_message='Etsy sync veya CSV import reconciliation sırasında source veriyi değiştirdi.',
        lease_token=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running' AND lease_token=?
    `,
  ).bind(runId, leaseToken).run();
}

export async function dispatchReconciliationOutbox(env: Env, limit = 20): Promise<number> {
  const rows = await env.DB
    .prepare(
      `
        SELECT id, reconciliation_run_id FROM etsy_reconciliation_outbox
        WHERE status='pending' AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at LIMIT ?
      `,
    )
    .bind(limit)
    .all<{ id: string; reconciliation_run_id: string }>();
  const sent: string[] = [];
  for (const row of rows.results ?? []) {
    await env.ETSY_SYNC_QUEUE.send({ kind: "reconciliation", runId: row.reconciliation_run_id });
    sent.push(row.id);
  }
  if (sent.length > 0) {
    const placeholders = sent.map(() => "?").join(",");
    await env.DB
      .prepare(
        `
          UPDATE etsy_reconciliation_outbox SET
            status='sent', sent_at=CURRENT_TIMESTAMP, attempt_count=attempt_count + 1
          WHERE id IN (${placeholders})
        `,
      )
      .bind(...sent)
      .run();
  }
  return sent.length;
}

export async function queueReconciliationRun(env: Env, runId: string): Promise<void> {
  await enqueueRun(env, runId);
  await dispatchReconciliationOutbox(env);
}

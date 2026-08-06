import type { EntityReconciliation } from "../_reconciliation";
import { loadCachedReconciliation } from "../_reconciliationCache";
import type { D1DatabaseWithAll } from "../_financialReconciliation";
import {
  clampRangeToPeriod,
  isValidIssueRequest,
  loadIssuePage,
  resolvePageSize,
  type IssueEntity,
  type IssueType,
} from "../_issues";

type Context = { request: Request; env: { DB: D1DatabaseWithAll } };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function rangeFor(
  entity: IssueEntity,
  reconciliation: {
    orders: EntityReconciliation;
    orderItems: EntityReconciliation;
    payments: EntityReconciliation;
  },
) {
  return reconciliation[entity].coverage.common;
}

export async function onRequestGet(context: Context): Promise<Response> {
  const url = new URL(context.request.url);
  const entity = url.searchParams.get("entity") ?? "";
  const type = url.searchParams.get("type") ?? "";

  if (!isValidIssueRequest(entity, type) && type !== "financial_difference") {
    return json(
      { ok: false, error: "invalid_issue_request", message: "Unknown entity/type combination." },
      400,
    );
  }

  const limit = resolvePageSize(Number(url.searchParams.get("limit")));
  const offsetParam = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.floor(offsetParam) : 0;

  try {
    const requestedRunId = url.searchParams.get("runId");
    const run = requestedRunId
      ? await context.env.DB.prepare(
          "SELECT id FROM etsy_reconciliation_runs WHERE id=? AND status='completed'",
        ).bind(requestedRunId).first<{ id: string }>()
      : await context.env.DB.prepare(
          "SELECT id FROM etsy_reconciliation_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1",
        ).first<{ id: string }>();
    if (run) {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const conditions = [
        "reconciliation_run_id=?",
        "entity=?",
        "issue_type=?",
        ...(from ? ["record_date>=?"] : []),
        ...(to ? ["record_date<=?"] : []),
      ];
      const params: unknown[] = [run.id, entity, type];
      if (from) params.push(from);
      if (to) params.push(to);
      const result = await context.env.DB.prepare(
        `
          SELECT COALESCE(entity_record_id,source_record_id) AS id,
            record_date AS date, amount, currency, detail, status,
            reason_code AS reasonCode, field_name AS fieldName,
            api_value AS apiValue, csv_value AS csvValue, difference
          FROM etsy_reconciliation_issues
          WHERE ${conditions.join(" AND ")}
          ORDER BY record_date DESC, source_record_id
          LIMIT ? OFFSET ?
        `,
      ).bind(...params, limit + 1, offset).all<Record<string, unknown>>();
      const rows = result.results ?? [];
      return json({
        ok: true,
        entity,
        type,
        items: rows.slice(0, limit),
        limit,
        offset,
        hasMore: rows.length > limit,
        reconciliationRunId: run.id,
        materialized: true,
      });
    }
    if (!isValidIssueRequest(entity, type)) {
      return json(
        { ok: false, error: "materialized_reconciliation_required" },
        409,
      );
    }
    const cached = await loadCachedReconciliation(context.env.DB);
    if (!cached) {
      return json(
        {
          ok: false,
          error: "reconciliation_cache_missing",
          message: "Open Reconciliation once to compute a cached generation before drilling into issues.",
        },
        409,
      );
    }
    const range = clampRangeToPeriod(
      rangeFor(entity, cached.reconciliation),
      url.searchParams.get("from"),
      url.searchParams.get("to"),
    );
    const page = await loadIssuePage(context.env.DB, entity, type as IssueType, range, limit, offset);
    return json({
      ok: true,
      ...page,
      cached: true,
      stale: cached.stale,
      generationRunId: cached.generationRunId,
    });
  } catch (error) {
    console.error("etsy_reconciliation_issues_failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, error: "etsy_reconciliation_issues_failed" }, 500);
  }
}

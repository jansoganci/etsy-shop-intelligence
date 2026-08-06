import type { EntityReconciliation } from "../../_reconciliation";
import { loadCachedReconciliation } from "../../_reconciliationCache";
import type { D1DatabaseWithAll } from "../../_financialReconciliation";
import {
  clampRangeToPeriod,
  isValidIssueRequest,
  loadAllIssuesForExport,
  toCsv,
  type IssueEntity,
  type IssueType,
} from "../../_issues";

type Context = { request: Request; env: { DB: D1DatabaseWithAll } };

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
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!isValidIssueRequest(entity, type) && type !== "financial_difference") {
    return Response.json(
      { ok: false, error: "invalid_issue_request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const run = await context.env.DB.prepare(
      "SELECT id,completed_at FROM etsy_reconciliation_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1",
    ).first<{ id: string; completed_at: string }>();
    if (run) {
      const conditions = ["reconciliation_run_id=?", "entity=?", "issue_type=?"];
      const params: unknown[] = [run.id, entity, type];
      if (from) {
        conditions.push("record_date>=?");
        params.push(from);
      }
      if (to) {
        conditions.push("record_date<=?");
        params.push(to);
      }
      const result = await context.env.DB.prepare(
        `
          SELECT COALESCE(entity_record_id,source_record_id) AS id,
            record_date AS date, status, reason_code, field_name,
            api_value, csv_value, difference, currency
          FROM etsy_reconciliation_issues
          WHERE ${conditions.join(" AND ")}
          ORDER BY record_date DESC, source_record_id LIMIT 10000
        `,
      ).bind(...params).all<Record<string, unknown>>();
      const cell = (value: unknown) => {
        const raw = value === null || value === undefined ? "" : String(value);
        const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
        return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
      };
      const columns = [
        "id", "date", "status", "reason_code", "field_name",
        "api_value", "csv_value", "difference", "currency",
      ];
      const rows = (result.results ?? []).map((row) =>
        columns.map((column) => cell(row[column])).join(","),
      );
      const body = [
        `# reconciliationRunId=${run.id} calculatedAt=${run.completed_at} rowCount=${rows.length}`,
        columns.join(","),
        ...rows,
        "",
      ].join("\n");
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${entity}-${type}-issues.csv"`,
          "cache-control": "private, max-age=60",
        },
      });
    }
    if (!isValidIssueRequest(entity, type)) {
      return Response.json(
        { ok: false, error: "materialized_reconciliation_required" },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    const cached = await loadCachedReconciliation(context.env.DB);
    if (!cached) {
      return Response.json(
        { ok: false, error: "reconciliation_cache_missing" },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    const range = clampRangeToPeriod(rangeFor(entity, cached.reconciliation), from, to);
    const items = await loadAllIssuesForExport(context.env.DB, entity, type as IssueType, range);

    const meta = [
      `# entity=${entity}`,
      `type=${type}`,
      `period=${range.min ?? "n/a"}..${range.max ?? "n/a"}`,
      `calculatedAt=${cached.reconciliation.calculatedAt}`,
      `generationRunId=${cached.generationRunId}`,
      `rowCount=${items.length}`,
    ].join(" ");
    const body = `${meta}\n${toCsv(items)}\n`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${entity}-${type}-issues.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("etsy_reconciliation_issues_export_failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { ok: false, error: "etsy_reconciliation_issues_export_failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

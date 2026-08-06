// Lightweight single-import status lookup, polled by the CSV upload modal
// while an import is processing asynchronously (see functions/api/imports/csv.ts).

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
}

type ImportStatusRow = {
  id: number;
  import_type: string;
  declared_type: string | null;
  detected_type: string | null;
  file_name: string | null;
  row_count: number | null;
  inserted_count: number | null;
  replaced_count: number | null;
  skipped_count: number | null;
  error_count: number | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  imported_at: string;
  error_message: string | null;
  failure_reason: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
};

function toNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return value;
}

export async function onRequestGet({
  env,
  params,
}: {
  env: Env;
  params: { id?: string };
}): Promise<Response> {
  const rawId = params.id ?? "";
  const importId = Number.parseInt(rawId, 10);

  if (!Number.isInteger(importId) || importId <= 0) {
    return Response.json({ ok: false, error: "invalid_import_id" }, { status: 400 });
  }

  let row: ImportStatusRow | null;

  try {
    row = await env.DB.prepare(
      `
        SELECT
          id,
          import_type,
          declared_type,
          detected_type,
          file_name,
          row_count,
          inserted_count,
          replaced_count,
          skipped_count,
          error_count,
          status,
          started_at,
          completed_at,
          failed_at,
          imported_at,
          error_message,
          failure_reason,
          date_range_start,
          date_range_end
        FROM imports
        WHERE id = ?
      `,
    )
      .bind(importId)
      .first<ImportStatusRow>();
  } catch {
    return Response.json({ ok: false, error: "import_status_failed" }, { status: 500 });
  }

  if (!row) {
    return Response.json({ ok: false, error: "import_not_found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    importId: row.id,
    importType: row.import_type,
    declaredType: row.declared_type,
    detectedType: row.detected_type,
    fileName: row.file_name,
    rowCount: toNumber(row.row_count),
    insertedCount: toNumber(row.inserted_count),
    replacedCount: toNumber(row.replaced_count),
    skippedCount: toNumber(row.skipped_count),
    errorCount: toNumber(row.error_count),
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    importedAt: row.imported_at,
    errorMessage: row.failure_reason ?? row.error_message,
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
  });
}

interface Env {
  DB: D1Database;
}

type ImportRow = {
  id: number;
  import_type: string;
  declared_type: string | null;
  detected_type: string | null;
  file_name: string | null;
  file_hash: string | null;
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
};

function toNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return value;
}

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  try {
    const result = await context.env.DB.prepare(
      `
        SELECT
          id,
          import_type,
          declared_type,
          detected_type,
          file_name,
          file_hash,
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
          failure_reason
        FROM imports
        ORDER BY COALESCE(started_at, imported_at) DESC, id DESC
        LIMIT 20
      `,
    ).all<ImportRow>();

    return Response.json({
      ok: true,
      imports: (result.results ?? []).map((row) => ({
        id: row.id,
        importType: row.import_type,
        declaredType: row.declared_type,
        detectedType: row.detected_type,
        fileName: row.file_name,
        fileHash: row.file_hash,
        rowCount: toNumber(row.row_count),
        // replacedCount is kept for API compatibility; imports skip existing rows (no overwrite).
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
      })),
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "imports_history_failed",
      },
      { status: 500 },
    );
  }
}

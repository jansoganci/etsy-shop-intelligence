import type { ReconciliationResult } from "./_reconciliation";
import type { MonthlyFinancialsResult } from "./_financialReconciliation";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type CachedReconciliationPayload = ReconciliationResult & {
  monthlyFinancials?: MonthlyFinancialsResult;
};

export type CachedReconciliation = {
  reconciliation: CachedReconciliationPayload;
  generationRunId: string;
  stale: boolean;
};

/**
 * Read-only access to the latest completed reconciliation generation.
 * Issues and cutover must use this path — never live loadReconciliation —
 * to avoid TRIM+EXISTS full-scan storms on every UI request.
 */
export async function loadCachedReconciliation(
  db: D1Database,
): Promise<CachedReconciliation | null> {
  const latestJob = await db
    .prepare(
      `
        SELECT id, status FROM etsy_sync_jobs
        ORDER BY created_at DESC LIMIT 1
      `,
    )
    .first<{ id: string; status: string }>();

  const cached = await db
    .prepare(
      `
        SELECT run_id, result_json FROM etsy_reconciliation_generations
        WHERE status='completed' AND result_json IS NOT NULL
        ORDER BY calculated_at DESC LIMIT 1
      `,
    )
    .first<{ run_id: string; result_json: string }>();

  if (!cached?.result_json) return null;

  const stale = Boolean(latestJob && latestJob.status !== "completed");
  return {
    reconciliation: JSON.parse(cached.result_json) as CachedReconciliationPayload,
    generationRunId: cached.run_id,
    stale,
  };
}

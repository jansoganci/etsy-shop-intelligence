import { loadReconciliation } from "./_reconciliation";
import {
  loadMonthlyFinancials,
  type D1DatabaseWithAll,
  type D1PreparedStatementWithAll,
} from "./_financialReconciliation";
import { detectDateBoundaryShifts } from "./_dateBoundary";

interface D1MutationStatement extends D1PreparedStatementWithAll {
  bind(...values: unknown[]): D1MutationStatement;
  run(): Promise<unknown>;
}

interface ReconciliationDatabase extends D1DatabaseWithAll {
  prepare(query: string): D1MutationStatement;
}

type Context = { env: { DB: ReconciliationDatabase } };

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const materialized = await context.env.DB.prepare(
      `
        SELECT id, summary_json, completed_at
        FROM etsy_reconciliation_runs
        WHERE status='completed' AND summary_json IS NOT NULL
        ORDER BY completed_at DESC LIMIT 1
      `,
    ).first<{ id: string; summary_json: string; completed_at: string }>();
    if (materialized) {
      const latestAttempt = await context.env.DB.prepare(
        `
          SELECT id, status, error_code, error_message, created_at
          FROM etsy_reconciliation_runs ORDER BY created_at DESC LIMIT 1
        `,
      ).first<Record<string, unknown>>();
      return Response.json({
        ok: true,
        reconciliation: JSON.parse(materialized.summary_json) as unknown,
        cached: true,
        materialized: true,
        reconciliationRunId: materialized.id,
        latestAttempt,
      });
    }
    const latestJob = await context.env.DB
      .prepare(
        `
          SELECT id, status FROM etsy_sync_jobs
          ORDER BY created_at DESC LIMIT 1
        `,
      )
      .first<{ id: string; status: string }>();
    if (latestJob && latestJob.status !== "completed") {
      const cached = await context.env.DB
        .prepare(
          `
            SELECT run_id, result_json FROM etsy_reconciliation_generations
            WHERE status='completed' AND result_json IS NOT NULL
            ORDER BY calculated_at DESC LIMIT 1
          `,
        )
        .first<{ run_id: string; result_json: string }>();
      if (cached) {
        return Response.json({
          ok: true,
          reconciliation: JSON.parse(cached.result_json) as unknown,
          cached: true,
          stale: true,
          generationRunId: cached.run_id,
        });
      }
      return Response.json(
        {
          ok: false,
          error: "reconciliation_waiting_for_completed_generation",
        },
        { status: 409 },
      );
    }
    const generation = await context.env.DB
      .prepare(
        `
          SELECT rg.id, rg.run_id, rg.status, rg.result_json
          FROM etsy_reconciliation_generations rg
          JOIN etsy_sync_jobs job ON job.id=rg.run_id
          WHERE job.status='completed'
          ORDER BY job.completed_at DESC LIMIT 1
        `,
      )
      .first<{
        id: string;
        run_id: string;
        status: string;
        result_json: string | null;
      }>();
    if (latestJob?.status === "completed" && !generation) {
      return Response.json(
        { ok: false, error: "reconciliation_generation_missing" },
        { status: 409 },
      );
    }
    if (generation?.status === "failed") {
      return Response.json(
        { ok: false, error: "reconciliation_generation_failed" },
        { status: 500 },
      );
    }
    if (generation?.status === "completed" && generation.result_json) {
      return Response.json({
        ok: true,
        reconciliation: JSON.parse(generation.result_json) as unknown,
        cached: true,
        generationRunId: generation.run_id,
      });
    }
    if (generation && generation.status !== "failed") {
      await context.env.DB
        .prepare(
          `
            UPDATE etsy_reconciliation_generations
            SET status='running', updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND status IN ('pending','queued')
          `,
        )
        .bind(generation.id)
        .run();
    }
    const reconciliation = await loadReconciliation(context.env.DB);
    const [monthlyFinancials, dateBoundary] = await Promise.all([
      loadMonthlyFinancials(context.env.DB, reconciliation.orders, reconciliation.payments),
      detectDateBoundaryShifts(context.env.DB, reconciliation.orders, reconciliation.payments),
    ]);
    const result = { ...reconciliation, monthlyFinancials, dateBoundary };
    if (generation) {
      await context.env.DB
        .prepare(
          `
            UPDATE etsy_reconciliation_generations SET
              status='completed', result_json=?, calculated_at=CURRENT_TIMESTAMP,
              error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `,
        )
        .bind(JSON.stringify(result), generation.id)
        .run();
      await context.env.DB
        .prepare(
          `
            UPDATE etsy_sync_jobs SET reconciliation_status='completed',
              updated_at=CURRENT_TIMESTAMP WHERE id=?
          `,
        )
        .bind(generation.run_id)
        .run();
    }
    return Response.json({
      ok: true,
      reconciliation: result,
      cached: false,
      generationRunId: generation?.run_id ?? null,
    });
  } catch (error) {
    console.error(
      "etsy_reconciliation_failed",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json(
      { ok: false, error: "etsy_reconciliation_failed" },
      { status: 500 },
    );
  }
}

import { loadCommerceSummary } from "./_commerceSummary";
import type { D1Database } from "../reports/_summary";

type Context = {
  request: Request;
  env: { DB: D1Database };
};

export async function onRequestGet(context: Context): Promise<Response> {
  const runId = new URL(context.request.url).searchParams.get("runId")?.trim();
  if (!runId) {
    return Response.json(
      { ok: false, error: "missing_run_id" },
      { status: 400 },
    );
  }

  try {
    const summary = await loadCommerceSummary(context.env.DB, runId);
    if (!summary) {
      return Response.json(
        { ok: false, error: "commerce_run_not_found" },
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      ...summary,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "commerce_summary_missing_period") {
      return Response.json(
        { ok: false, error: "commerce_summary_missing_period" },
        { status: 400 },
      );
    }

    return Response.json(
      { ok: false, error: "data_center_commerce_summary_failed" },
      { status: 500 },
    );
  }
}

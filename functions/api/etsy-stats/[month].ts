import {
  deleteMonthlyStats,
  loadMonthlyStats,
  saveMonthlyStats,
  type D1Database,
} from "./_db";
import { validateMonthlyStats } from "./_validation";

type Context = {
  request: Request;
  env: { DB: D1Database };
  params: { month?: string | string[] };
};

function readMonth(params: Context["params"]): string {
  const value = params.month;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export async function onRequestGet(context: Context): Promise<Response> {
  const month = readMonth(context.params);
  if (!isMonth(month)) {
    return Response.json({ ok: false, error: "invalid_month" }, { status: 400 });
  }

  try {
    const record = (await loadMonthlyStats(context.env.DB, month))[0] ?? null;
    if (!record) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return Response.json({ ok: true, stats: record });
  } catch {
    return Response.json(
      { ok: false, error: "etsy_stats_load_failed" },
      { status: 500 },
    );
  }
}

export async function onRequestPut(context: Context): Promise<Response> {
  const month = readMonth(context.params);
  if (!isMonth(month)) {
    return Response.json({ ok: false, error: "invalid_month" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json", message: "The request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const validation = validateMonthlyStats(payload, { expectedMonth: month });
  if (!validation.valid || !validation.normalized) {
    return Response.json(
      { ok: false, error: "validation_failed", ...validation },
      { status: 422 },
    );
  }

  try {
    await saveMonthlyStats(context.env.DB, validation.normalized);
    const saved = (await loadMonthlyStats(context.env.DB, month))[0] ?? null;
    return Response.json({
      ok: true,
      stats: saved,
      warnings: validation.warnings,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "etsy_stats_save_failed",
        message: "Monthly Etsy Stats could not be saved.",
      },
      { status: 500 },
    );
  }
}

export async function onRequestDelete(context: Context): Promise<Response> {
  const month = readMonth(context.params);
  if (!isMonth(month)) {
    return Response.json({ ok: false, error: "invalid_month" }, { status: 400 });
  }

  try {
    await deleteMonthlyStats(context.env.DB, month);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { ok: false, error: "etsy_stats_delete_failed" },
      { status: 500 },
    );
  }
}

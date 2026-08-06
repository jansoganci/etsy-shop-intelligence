import { deleteShopEvent, updateShopEvent, type D1Database } from "./_db";
import { validateShopEvent } from "./_validation";

type Context = {
  request: Request;
  env: { DB: D1Database };
  params: { id?: string | string[] };
};

function readId(params: Context["params"]): number | null {
  const value = Array.isArray(params.id) ? params.id[0] : params.id;
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestPut(context: Context): Promise<Response> {
  const id = readId(context.params);
  if (id === null) {
    return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
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

  const validation = validateShopEvent(payload);
  if (!validation.valid || !validation.normalized) {
    return Response.json(
      { ok: false, error: "validation_failed", ...validation },
      { status: 422 },
    );
  }

  try {
    const event = await updateShopEvent(context.env.DB, id, validation.normalized);
    if (!event) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return Response.json({ ok: true, event, warnings: validation.warnings });
  } catch {
    return Response.json({ ok: false, error: "shop_event_save_failed" }, { status: 500 });
  }
}

export async function onRequestDelete(context: Context): Promise<Response> {
  const id = readId(context.params);
  if (id === null) {
    return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  try {
    await deleteShopEvent(context.env.DB, id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "shop_event_delete_failed" }, { status: 500 });
  }
}

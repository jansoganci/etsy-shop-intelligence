import { createShopEvent, loadShopEvents, type D1Database } from "./_db";
import { validateShopEvent } from "./_validation";

type Context = {
  request: Request;
  env: { DB: D1Database };
};

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const listingId = url.searchParams.get("listingId") ?? undefined;
    const eventType = url.searchParams.get("eventType") ?? undefined;
    const events = await loadShopEvents(context.env.DB, { listingId, eventType });
    return Response.json({ ok: true, events });
  } catch {
    return Response.json({ ok: false, error: "shop_events_load_failed" }, { status: 500 });
  }
}

export async function onRequestPost(context: Context): Promise<Response> {
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
    const event = await createShopEvent(context.env.DB, validation.normalized, "manual");
    return Response.json({ ok: true, event, warnings: validation.warnings }, { status: 201 });
  } catch {
    return Response.json(
      { ok: false, error: "shop_event_save_failed", message: "The event could not be saved." },
      { status: 500 },
    );
  }
}

import { loadListingHistory, type D1Database } from "../_db";

type Context = {
  env: { DB: D1Database };
  params: { listingId?: string | string[] };
};

function readListingId(params: Context["params"]): string {
  const value = params.listingId;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export async function onRequestGet(context: Context): Promise<Response> {
  const listingId = readListingId(context.params);
  if (!listingId) {
    return Response.json({ ok: false, error: "invalid_listing_id" }, { status: 400 });
  }

  try {
    const versions = await loadListingHistory(context.env.DB, listingId);
    return Response.json({ ok: true, versions });
  } catch {
    return Response.json({ ok: false, error: "listing_history_load_failed" }, { status: 500 });
  }
}

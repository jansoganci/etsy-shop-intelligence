import { loadListing, saveListing, type D1Database } from "./_db";
import { validateListing } from "./_validation";

type Context = {
  request: Request;
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
    const listing = await loadListing(context.env.DB, listingId);
    if (!listing) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return Response.json({ ok: true, listing });
  } catch {
    return Response.json({ ok: false, error: "listing_load_failed" }, { status: 500 });
  }
}

export async function onRequestPut(context: Context): Promise<Response> {
  const listingId = readListingId(context.params);
  if (!listingId) {
    return Response.json({ ok: false, error: "invalid_listing_id" }, { status: 400 });
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

  const validation = validateListing(payload, { expectedListingId: listingId });
  if (!validation.valid || !validation.normalized) {
    return Response.json(
      { ok: false, error: "validation_failed", ...validation },
      { status: 422 },
    );
  }

  try {
    const { record, versionCreated } = await saveListing(context.env.DB, validation.normalized);
    return Response.json({
      ok: true,
      listing: record,
      versionCreated,
      warnings: validation.warnings,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "etsy_listing_read_only") {
      return Response.json(
        {
          ok: false,
          error: "etsy_listing_read_only",
          message: "Etsy API alanları salt okunur. Değişikliği Etsy üzerinde yapıp sync çalıştır.",
        },
        { status: 409 },
      );
    }
    console.error("listing_save_failed", error);
    return Response.json(
      { ok: false, error: "listing_save_failed", message: "The listing could not be saved." },
      { status: 500 },
    );
  }
}

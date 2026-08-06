import { loadListings, type D1Database } from "./_db";

type Context = {
  env: { DB: D1Database };
};

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const listings = await loadListings(context.env.DB);
    const connection = await context.env.DB
      .prepare("SELECT shop_id FROM etsy_connections WHERE status='connected' LIMIT 1")
      .first();
    return Response.json({
      ok: true,
      listings,
      summary: {
        count: listings.length,
        activeCount: listings.filter((listing) => listing.status === "active").length,
        missingAltTextCount: listings.filter((listing) => listing.imageAltTexts.length === 0)
          .length,
        apiCount: listings.filter((listing) => listing.source === "etsy_api").length,
        etsyConnected: Boolean(connection),
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "listings_load_failed", message: "Listings could not be loaded." },
      { status: 500 },
    );
  }
}

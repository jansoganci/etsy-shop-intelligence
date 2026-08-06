import { getListingAgg, type ListingAggRow } from "../ai/_intelligenceQueries";
import type { DateRange } from "../intelligence/_overview";
import { getActiveListingCount, getLatestTopPagesSnapshot, getListingTitles, type D1Database } from "./_db";
import { extractListingIdFromPagePath } from "./_pagePathParser";
import { resolveGaDateRange } from "./_relativeDate";
import { computeGuardrailStatus } from "./_guardrails";
import { classifyQuadrants, type ListingTrafficSalesRow } from "./_quadrant";

type Context = {
  request: Request;
  env: { DB: D1Database };
};

const NUMERIC_LISTING_ID = /^\d+$/;

function toNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toDateRange(range: { from: string; to: string }): DateRange {
  const dayCount =
    Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;

  return { from: range.from, to: range.to, month: range.from.slice(0, 7), dayCount, isPartial: false };
}

export async function onRequestGet(context: Context): Promise<Response> {
  const db = context.env.DB;

  const snapshot = await getLatestTopPagesSnapshot(db);
  if (!snapshot) {
    return Response.json({ ok: true, available: false, reason: "no_ga_top_pages" });
  }

  const commonRange = resolveGaDateRange(snapshot.dateFrom, snapshot.dateTo, snapshot.syncedAt);
  if (!commonRange) {
    return Response.json({ ok: true, available: false, reason: "date_range_unresolved" });
  }

  const gaMetricsByListing = new Map<string, { pageViews: number; sessions: number }>();
  let matchedPageRows = 0;
  for (const page of snapshot.pages) {
    const listingId = extractListingIdFromPagePath(page.pagePath);
    if (!listingId) {
      continue;
    }
    matchedPageRows += 1;
    const existing = gaMetricsByListing.get(listingId) ?? { pageViews: 0, sessions: 0 };
    existing.pageViews += toNumber(page.screenPageViews);
    existing.sessions += toNumber(page.sessions);
    gaMetricsByListing.set(listingId, existing);
  }

  const salesRows = await getListingAgg(db, toDateRange(commonRange));
  const salesByListing = new Map<string, ListingAggRow>();
  for (const row of salesRows) {
    if (row.listingId && NUMERIC_LISTING_ID.test(row.listingId)) {
      salesByListing.set(row.listingId, row);
    }
  }

  const allListingIds = new Set<string>([...gaMetricsByListing.keys(), ...salesByListing.keys()]);
  const gaOnlyIds = [...allListingIds].filter((id) => !salesByListing.has(id));
  const fallbackTitles = await getListingTitles(db, gaOnlyIds);

  const combinedRows: ListingTrafficSalesRow[] = [...allListingIds].map((listingId) => {
    const ga = gaMetricsByListing.get(listingId);
    const sale = salesByListing.get(listingId);
    return {
      listingId,
      listingTitle: sale?.listingTitle ?? fallbackTitles.get(listingId) ?? null,
      pageViews: ga?.pageViews ?? 0,
      sessions: ga?.sessions ?? 0,
      orderCount: toNumber(sale?.orderCount),
      unitsSold: toNumber(sale?.unitsSold),
    };
  });

  const activeListingCount = await getActiveListingCount(db);
  const guardrails = computeGuardrailStatus({
    totalPageRows: snapshot.pages.length,
    matchedPageRows,
    activeListingCount,
    matchedListingCount: gaMetricsByListing.size,
    commonRange,
  });

  const { rows, trafficMedian, salesMedian } = classifyQuadrants(combinedRows);

  return Response.json({
    ok: true,
    available: true,
    guardrails,
    rows,
    quadrantMedians: { trafficMedian, salesMedian },
  });
}

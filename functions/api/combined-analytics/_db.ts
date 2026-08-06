import { queryAll, queryFirst, type D1Database } from "../reports/_summary";

export type { D1Database };

export type TopPageRow = {
  pagePath: string;
  pageTitle: string | null;
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
};

export type TopPagesSnapshot = {
  propertyId: string;
  dateFrom: string;
  dateTo: string;
  syncedAt: string;
  pages: TopPageRow[];
};

export async function getLatestTopPagesSnapshot(db: D1Database): Promise<TopPagesSnapshot | null> {
  const latest = await queryFirst<{
    propertyId: string;
    dateFrom: string;
    dateTo: string;
    syncedAt: string;
  }>(
    db,
    `
      SELECT property_id AS propertyId, date_from AS dateFrom, date_to AS dateTo, MAX(synced_at) AS syncedAt
      FROM ga_top_pages
      GROUP BY property_id, date_from, date_to
      ORDER BY syncedAt DESC
      LIMIT 1
    `,
  );

  if (!latest) {
    return null;
  }

  const pages = await queryAll<TopPageRow>(
    db,
    `
      SELECT page_path AS pagePath, page_title AS pageTitle, active_users AS activeUsers,
             sessions, screen_page_views AS screenPageViews
      FROM ga_top_pages
      WHERE property_id = ? AND date_from = ? AND date_to = ?
    `,
    [latest.propertyId, latest.dateFrom, latest.dateTo],
  );

  return { ...latest, pages };
}

export async function getActiveListingCount(db: D1Database): Promise<number> {
  const row = await queryFirst<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM listings WHERE status = 'active'`,
  );
  return row?.count ?? 0;
}

export async function getListingTitles(
  db: D1Database,
  listingIds: string[],
): Promise<Map<string, string | null>> {
  if (listingIds.length === 0) {
    return new Map();
  }

  const placeholders = listingIds.map(() => "?").join(",");
  const rows = await queryAll<{ listingId: string; title: string | null }>(
    db,
    `
      SELECT l.listing_id AS listingId, lv.title AS title
      FROM listings l
      LEFT JOIN listing_versions lv ON lv.id = l.current_version_id
      WHERE l.listing_id IN (${placeholders})
    `,
    listingIds,
  );

  return new Map(rows.map((row) => [row.listingId, row.title]));
}

export type ReviewSort =
  | "newest"
  | "oldest"
  | "rating_high"
  | "rating_low"
  | "updated";

export type ReviewQuery = {
  page: number;
  pageSize: number;
  q: string | null;
  rating: number | null;
  dateFrom: number | null;
  dateToExclusive: number | null;
  listingId: string | null;
  sort: ReviewSort;
};

const SORT_SQL: Record<ReviewSort, string> = {
  newest: "r.create_timestamp DESC, r.review_key DESC",
  oldest: "r.create_timestamp ASC, r.review_key ASC",
  rating_high: "r.rating DESC, r.create_timestamp DESC, r.review_key DESC",
  rating_low: "r.rating ASC, r.create_timestamp DESC, r.review_key DESC",
  updated: "COALESCE(r.update_timestamp, r.create_timestamp) DESC, r.review_key DESC",
};

function clampInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = value == null ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function normalize(value: string | null): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function startOfUtcDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

export function parseReviewQuery(url: URL): ReviewQuery {
  const requestedRating = clampInteger(url.searchParams.get("rating"), 0, 0, 5);
  const requestedSort = normalize(url.searchParams.get("sort"));
  const sort = requestedSort && requestedSort in SORT_SQL
    ? requestedSort as ReviewSort
    : "newest";
  const dateTo = startOfUtcDay(url.searchParams.get("dateTo"));

  return {
    page: clampInteger(url.searchParams.get("page"), 1, 1, 1_000_000),
    pageSize: clampInteger(url.searchParams.get("pageSize"), 25, 1, 100),
    q: normalize(url.searchParams.get("q")),
    rating: requestedRating >= 1 ? requestedRating : null,
    dateFrom: startOfUtcDay(url.searchParams.get("dateFrom")),
    dateToExclusive: dateTo == null ? null : dateTo + 86_400,
    listingId: normalize(url.searchParams.get("listingId")),
    sort,
  };
}

export function buildReviewWhere(query: ReviewQuery, shopId: string): {
  sql: string;
  bindings: Array<string | number>;
} {
  const clauses = ["r.shop_id = ?"];
  const bindings: Array<string | number> = [shopId];

  if (query.q) {
    clauses.push(`(
      r.review_text LIKE ? COLLATE NOCASE
      OR l.title LIKE ? COLLATE NOCASE
      OR r.listing_id LIKE ?
      OR r.transaction_id LIKE ?
      OR t.receipt_id LIKE ?
    )`);
    const value = `%${query.q}%`;
    bindings.push(value, value, value, value, value);
  }
  if (query.rating != null) {
    clauses.push("r.rating = ?");
    bindings.push(query.rating);
  }
  if (query.dateFrom != null) {
    clauses.push("r.create_timestamp >= ?");
    bindings.push(query.dateFrom);
  }
  if (query.dateToExclusive != null) {
    clauses.push("r.create_timestamp < ?");
    bindings.push(query.dateToExclusive);
  }
  if (query.listingId) {
    clauses.push("r.listing_id = ?");
    bindings.push(query.listingId);
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    bindings,
  };
}

export function reviewSortSql(sort: ReviewSort): string {
  return SORT_SQL[sort];
}

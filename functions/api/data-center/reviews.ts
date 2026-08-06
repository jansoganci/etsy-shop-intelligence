import {
  buildReviewWhere,
  parseReviewQuery,
  reviewSortSql,
} from "./_reviews";

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

type Context = {
  request: Request;
  env: { DB: D1Database };
};

type CountRow = {
  totalCount: number | null;
  averageRating: number | null;
};

type DistributionRow = {
  rating: number;
  count: number;
};

type ListingOptionRow = {
  listingId: string;
  listingTitle: string | null;
};

function asNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const connection = await context.env.DB
      .prepare(
        "SELECT shop_id AS shopId FROM etsy_connections WHERE status='connected' LIMIT 1",
      )
      .first<{ shopId: string }>();
    if (!connection) {
      return Response.json(
        { ok: false, error: "etsy_not_connected" },
        { status: 409 },
      );
    }

    const query = parseReviewQuery(new URL(context.request.url));
    const where = buildReviewWhere(query, connection.shopId);
    const joins = `
      FROM etsy_api_reviews AS r
      LEFT JOIN etsy_api_listings AS l ON l.listing_id = r.listing_id
      LEFT JOIN etsy_api_transactions AS t ON t.transaction_id = r.transaction_id
    `;

    const [summary, distributionResult, rowsResult, listingsResult] =
      await Promise.all([
        context.env.DB
          .prepare(
            `
              SELECT
                COUNT(*) AS totalCount,
                AVG(r.rating) AS averageRating
              ${joins}
              ${where.sql}
            `,
          )
          .bind(...where.bindings)
          .first<CountRow>(),
        context.env.DB
          .prepare(
            `
              SELECT r.rating AS rating, COUNT(*) AS count
              ${joins}
              ${where.sql}
              GROUP BY r.rating
              ORDER BY r.rating DESC
            `,
          )
          .bind(...where.bindings)
          .all<DistributionRow>(),
        context.env.DB
          .prepare(
            `
              SELECT
                r.review_key AS reviewKey,
                r.create_timestamp AS createTimestamp,
                r.update_timestamp AS updateTimestamp,
                r.rating AS rating,
                r.review_text AS reviewText,
                r.language AS language,
                r.image_url AS imageUrl,
                r.listing_id AS listingId,
                l.title AS listingTitle,
                r.transaction_id AS transactionId,
                t.receipt_id AS receiptId
              ${joins}
              ${where.sql}
              ORDER BY ${reviewSortSql(query.sort)}
              LIMIT ? OFFSET ?
            `,
          )
          .bind(
            ...where.bindings,
            query.pageSize,
            (query.page - 1) * query.pageSize,
          )
          .all<Record<string, unknown>>(),
        context.env.DB
          .prepare(
            `
              SELECT DISTINCT
                r.listing_id AS listingId,
                l.title AS listingTitle
              FROM etsy_api_reviews AS r
              LEFT JOIN etsy_api_listings AS l ON l.listing_id = r.listing_id
              WHERE r.shop_id = ? AND r.listing_id IS NOT NULL
              ORDER BY COALESCE(l.title, r.listing_id) COLLATE NOCASE
              LIMIT 500
            `,
          )
          .bind(connection.shopId)
          .all<ListingOptionRow>(),
      ]);

    const totalCount = asNumber(summary?.totalCount);
    const distribution = Object.fromEntries(
      [1, 2, 3, 4, 5].map((rating) => [rating, 0]),
    ) as Record<number, number>;
    for (const row of distributionResult.results ?? []) {
      if (row.rating >= 1 && row.rating <= 5) {
        distribution[row.rating] = asNumber(row.count);
      }
    }

    return Response.json({
      ok: true,
      reviews: rowsResult.results ?? [],
      summary: {
        totalCount,
        averageRating: summary?.averageRating ?? null,
        distribution,
      },
      listings: listingsResult.results ?? [],
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalRows: totalCount,
        totalPages: totalCount > 0 ? Math.ceil(totalCount / query.pageSize) : 0,
      },
      filters: {
        q: query.q,
        rating: query.rating,
        listingId: query.listingId,
        sort: query.sort,
      },
      capabilities: {
        buyerName: false,
        sellerResponse: false,
        responseStatus: false,
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "reviews_load_failed" },
      { status: 500 },
    );
  }
}

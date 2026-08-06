import { describe, expect, it } from "vitest";
import {
  buildReviewWhere,
  parseReviewQuery,
  reviewSortSql,
} from "./_reviews";

describe("Data Center review query", () => {
  it("uses safe defaults and caps page size", () => {
    const query = parseReviewQuery(
      new URL("https://example.test/api/data-center/reviews?page=-2&pageSize=500"),
    );
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(100);
    expect(query.sort).toBe("newest");
    expect(query.rating).toBeNull();
  });

  it("normalizes filters and makes the end date inclusive", () => {
    const query = parseReviewQuery(
      new URL(
        "https://example.test/api/data-center/reviews?q=great&rating=5&dateFrom=2026-07-01&dateTo=2026-07-03&listingId=42&sort=rating_high",
      ),
    );
    expect(query).toMatchObject({
      q: "great",
      rating: 5,
      listingId: "42",
      sort: "rating_high",
    });
    expect(query.dateToExclusive! - query.dateFrom!).toBe(3 * 86_400);
  });

  it("binds user input instead of interpolating it into SQL", () => {
    const query = parseReviewQuery(
      new URL("https://example.test/api/data-center/reviews?q=%27%20OR%201%3D1--"),
    );
    const where = buildReviewWhere(query, "shop-1");
    expect(where.sql).not.toContain("' OR 1=1--");
    expect(where.bindings).toContain("%' OR 1=1--%");
  });

  it("only exposes allowlisted sort expressions", () => {
    const query = parseReviewQuery(
      new URL("https://example.test/api/data-center/reviews?sort=DROP%20TABLE"),
    );
    expect(query.sort).toBe("newest");
    expect(reviewSortSql(query.sort)).toBe(
      "r.create_timestamp DESC, r.review_key DESC",
    );
  });
});

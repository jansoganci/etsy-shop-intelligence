import { sha256 } from "../crypto";
import { etsyFetch } from "../etsy";
import {
  ETSY_EPOCH_MIN,
  deterministicTaskKey,
  normalizePageSize,
} from "../engine/planner";
import { readEtsyRateHeaders, retryDecision } from "../engine/rateLimit";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  PersistCounts,
  SyncTask,
  TaskPlan,
} from "../engine/types";
import type { EtsyListResponse, EtsyReview } from "../types";

type KeyedReview = EtsyReview & { reviewKey: string };

type ReviewCursor = {
  mode: "window";
  maxSeenTimestamp?: number;
  complete?: boolean;
};

function cursor(task: SyncTask): ReviewCursor {
  const raw = task.cursor as Partial<ReviewCursor>;
  return {
    mode: "window",
    maxSeenTimestamp:
      typeof raw.maxSeenTimestamp === "number" ? raw.maxSeenTimestamp : 0,
    complete: raw.complete === true,
  };
}

export class ReviewsAdapter implements EtsyResourceAdapter<KeyedReview> {
  readonly resource = "reviews";
  readonly version = 2;
  readonly strategy = "time_windowed" as const;
  readonly dependencies = ["shop"] as const;
  readonly deletionPolicy = "none" as const;

  async planInitial(
    context: AdapterContext,
    runId: string,
    shopId: string,
  ): Promise<TaskPlan[]> {
    const prior = await context.db
      .prepare(
        `
          SELECT cursor_value FROM etsy_sync_cursors
          WHERE shop_id=? AND resource='reviews' AND cursor_key='last_modified'
        `,
      )
      .bind(shopId)
      .first<{ cursor_value: string | null }>();
    const end = Math.floor(context.now.getTime() / 1000);
    const previous = Number(prior?.cursor_value);
    const incremental = Number.isFinite(previous) && previous >= ETSY_EPOCH_MIN;
    const start = incremental
      ? Math.max(ETSY_EPOCH_MIN, previous - 3600)
      : ETSY_EPOCH_MIN;
    return [{
      resource: this.resource,
      adapterVersion: this.version,
      strategy: this.strategy,
      idempotencyKey: deterministicTaskKey(
        runId,
        this.resource,
        this.strategy,
        start,
        end,
        0,
      ),
      cursor: { mode: "window", maxSeenTimestamp: previous || 0 },
      segmentStart: start,
      segmentEnd: end,
      pageOffset: 0,
      pageSize: 100,
    }];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<KeyedReview>> {
    if (task.segmentStart == null || task.segmentEnd == null) {
      throw new Error("reviews_segment_missing");
    }
    const pageSize = normalizePageSize(task.pageSize);
    const response = await etsyFetch<EtsyListResponse<EtsyReview>>(
      context.env,
      task.shopId,
      `/v3/application/shops/${task.shopId}/reviews`,
      new URLSearchParams({
        min_created: String(task.segmentStart),
        max_created: String(task.segmentEnd),
        limit: String(pageSize),
        offset: String(task.pageOffset),
      }),
    );
    const source = response.body.results ?? [];
    const records = await Promise.all(
      source.map(async (review) => ({
        ...review,
        reviewKey: await sha256(
          `${task.shopId}:${review.transaction_id ?? review.listing_id ?? ""}:${
            review.created_timestamp ?? review.create_timestamp ?? ""
          }`,
        ),
      })),
    );
    const count = typeof response.body.count === "number" ? response.body.count : null;
    const nextOffset = task.pageOffset + records.length;
    const hasMore = count != null ? nextOffset < count : records.length === pageSize;
    const priorMax = cursor(task).maxSeenTimestamp ?? 0;
    const maxSeenTimestamp = records.reduce((max, review) => {
      const ts = Number(
        review.updated_timestamp ??
          review.update_timestamp ??
          review.created_timestamp ??
          review.create_timestamp ??
          0,
      );
      return Number.isFinite(ts) ? Math.max(max, ts) : max;
    }, priorMax);
    return {
      records,
      responseCount: count,
      nextCursor: hasMore
        ? { mode: "window", maxSeenTimestamp, offset: nextOffset }
        : { mode: "window", maxSeenTimestamp, complete: true },
      pageKey:
        `${this.resource}:${task.segmentStart}:${task.segmentEnd}:${task.pageOffset}`,
      ...readEtsyRateHeaders(response.headers),
    };
  }

  async persistPage(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<KeyedReview>,
  ): Promise<PersistCounts> {
    const keys = page.records.map((review) => review.reviewKey);
    const existingRows = keys.length
      ? await context.db
          .prepare(
            `
              SELECT review_key FROM etsy_api_reviews
              WHERE review_key IN (
                SELECT CAST(value AS TEXT) FROM json_each(?)
              )
            `,
          )
          .bind(JSON.stringify(keys))
          .all<{ review_key: string }>()
      : { results: [] };
    const existing = new Set((existingRows.results ?? []).map((row) => row.review_key));
    const records = page.records.map((review) => ({
      reviewKey: review.reviewKey,
      shopId: task.shopId,
      transactionId: review.transaction_id == null ? null : String(review.transaction_id),
      listingId: review.listing_id == null ? null : String(review.listing_id),
      rating: review.rating ?? 0,
      reviewText: review.review ?? null,
      language: review.language ?? null,
      imageUrl: review.image_url_fullxfull ?? null,
      createTimestamp: review.created_timestamp ?? review.create_timestamp ?? null,
      updateTimestamp: review.updated_timestamp ?? review.update_timestamp ?? null,
    }));
    if (records.length) {
      await context.db
        .prepare(
          `
            INSERT INTO etsy_api_reviews (
              review_key, shop_id, transaction_id, listing_id, rating, review_text, language,
              image_url, create_timestamp, update_timestamp, synced_at
            )
            SELECT
              json_extract(value,'$.reviewKey'), json_extract(value,'$.shopId'),
              json_extract(value,'$.transactionId'),
              json_extract(value,'$.listingId'), json_extract(value,'$.rating'),
              json_extract(value,'$.reviewText'), json_extract(value,'$.language'),
              json_extract(value,'$.imageUrl'), json_extract(value,'$.createTimestamp'),
              json_extract(value,'$.updateTimestamp'), CURRENT_TIMESTAMP
            FROM json_each(?) WHERE 1
            ON CONFLICT(review_key) DO UPDATE SET
              transaction_id=excluded.transaction_id,
              listing_id=excluded.listing_id, rating=excluded.rating,
              review_text=excluded.review_text, language=excluded.language,
              image_url=excluded.image_url,
              create_timestamp=excluded.create_timestamp,
              update_timestamp=excluded.update_timestamp,
              synced_at=CURRENT_TIMESTAMP
          `,
        )
        .bind(JSON.stringify(records))
        .run();
    }
    const inserted = keys.filter((key) => !existing.has(key)).length;
    return {
      source: keys.length,
      fetched: keys.length,
      inserted,
      updated: keys.length - inserted,
      unchanged: 0,
    };
  }

  async planNext(): Promise<TaskPlan[]> {
    return [];
  }

  retryPolicy(error: unknown, attempt: number) {
    return retryDecision(error, attempt);
  }
}

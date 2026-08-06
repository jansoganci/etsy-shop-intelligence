import { upsertListing } from "../db";
import { etsyFetch } from "../etsy";
import { deterministicTaskKey, normalizePageSize } from "../engine/planner";
import { readEtsyRateHeaders, retryDecision } from "../engine/rateLimit";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  PersistCounts,
  SyncTask,
  TaskPlan,
} from "../engine/types";
import type { EtsyListResponse, EtsyListing } from "../types";
import { placeholders } from "./common";

const LISTING_STATES = ["active", "inactive", "sold_out", "draft", "expired"] as const;

type ListingCursor = {
  stateIndex: number;
  state: string;
};

function listingCursor(task: SyncTask): ListingCursor {
  const stateIndex =
    typeof task.cursor.stateIndex === "number" ? task.cursor.stateIndex : 0;
  return {
    stateIndex,
    state: LISTING_STATES[stateIndex] ?? LISTING_STATES[0],
  };
}

export class ListingsAdapter implements EtsyResourceAdapter<EtsyListing> {
  readonly resource = "listings";
  readonly version = 1;
  readonly strategy = "offset_paged" as const;
  readonly dependencies = ["shop"] as const;
  readonly deletionPolicy = "full_snapshot" as const;

  async planInitial(
    _context: AdapterContext,
    runId: string,
  ): Promise<TaskPlan[]> {
    return [{
      resource: this.resource,
      adapterVersion: this.version,
      strategy: this.strategy,
      idempotencyKey: deterministicTaskKey(runId, this.resource, this.strategy, null, null, 0),
      cursor: { stateIndex: 0, state: LISTING_STATES[0], mode: "full" },
      pageOffset: 0,
      // Listing projection writes version/history rows in addition to the
      // source row. Five records keeps a Queue delivery under D1 Free's query
      // budget without sacrificing resumability.
      pageSize: 5,
    }];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<EtsyListing>> {
    const pageSize = normalizePageSize(task.pageSize);
    const current = listingCursor(task);
    const response = await etsyFetch<EtsyListResponse<EtsyListing>>(
      context.env,
      task.shopId,
      `/v3/application/shops/${task.shopId}/listings`,
      new URLSearchParams({
        state: current.state,
        limit: String(pageSize),
        offset: String(task.pageOffset),
        includes: "Images,Videos,Personalization",
      }),
    );
    const records = response.body.results ?? [];
    const count = typeof response.body.count === "number" ? response.body.count : null;
    const nextOffset = task.pageOffset + records.length;
    let nextCursor: Record<string, unknown> | null = null;
    if (count != null ? nextOffset < count : records.length === pageSize) {
      nextCursor = { ...current, mode: "full", offset: nextOffset };
    } else if (current.stateIndex + 1 < LISTING_STATES.length) {
      nextCursor = {
        stateIndex: current.stateIndex + 1,
        state: LISTING_STATES[current.stateIndex + 1],
        mode: "full",
        offset: 0,
      };
    }
    return {
      records,
      // Runtime offset protection applies to the current Etsy state.
      responseCount: count,
      nextCursor,
      pageKey: `${this.resource}:${current.state}:${task.pageOffset}`,
      ...readEtsyRateHeaders(response.headers),
    };
  }

  async persistPage(
    context: AdapterContext,
    _task: SyncTask,
    page: AdapterPage<EtsyListing>,
  ): Promise<PersistCounts> {
    const ids = page.records.map((listing) => String(listing.listing_id));
    const existingRows = ids.length
      ? await context.db
          .prepare(
            `SELECT listing_id, content_hash FROM etsy_api_listings WHERE listing_id IN (${placeholders(ids.length)})`,
          )
          .bind(...ids)
          .all<{ listing_id: string; content_hash: string }>()
      : { results: [] };
    const existing = new Map(
      (existingRows.results ?? []).map((row) => [row.listing_id, row.content_hash]),
    );
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const listing of page.records) {
      const id = String(listing.listing_id);
      const outcome = await upsertListing(
        context.db,
        listing,
        existing.get(id) ?? null,
      );
      if (outcome === "inserted") inserted += 1;
      else if (outcome === "updated") updated += 1;
      else unchanged += 1;
    }
    return {
      source: page.records.length,
      fetched: page.records.length,
      inserted,
      updated,
      unchanged,
    };
  }

  async planNext(): Promise<TaskPlan[]> {
    return [];
  }

  async finalize(context: AdapterContext, runId: string, shopId: string): Promise<void> {
    await context.db.batch([
      context.db
        .prepare(
          `
            UPDATE etsy_api_listings SET state='inactive'
            WHERE shop_id=? AND datetime(synced_at) < datetime((
              SELECT created_at FROM etsy_sync_jobs WHERE id=?
            ))
          `,
        )
        .bind(shopId, runId),
      context.db
        .prepare(
          `
            UPDATE listings SET status='inactive', updated_at=CURRENT_TIMESTAMP
            WHERE listing_id IN (
              SELECT listing_id FROM etsy_api_listings
              WHERE shop_id=? AND state='inactive'
                AND datetime(synced_at) < datetime((
                  SELECT created_at FROM etsy_sync_jobs WHERE id=?
                ))
            )
          `,
        )
        .bind(shopId, runId),
    ]);
  }

  retryPolicy(error: unknown, attempt: number) {
    return retryDecision(error, attempt);
  }
}

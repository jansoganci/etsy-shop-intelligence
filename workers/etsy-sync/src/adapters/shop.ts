import { upsertShop } from "../db";
import { EtsyApiError, etsyFetch } from "../etsy";
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
import type { EtsyListResponse, EtsyShop, EtsyShopSection } from "../types";

const SHOP_FRESHNESS_MS = 6 * 60 * 60 * 1000;

export class ShopAdapter implements EtsyResourceAdapter<EtsyShop> {
  readonly resource = "shop";
  readonly version = 2;
  readonly strategy = "singleton" as const;
  readonly dependencies = [] as const;
  readonly deletionPolicy = "none" as const;

  async planInitial(
    context: AdapterContext,
    runId: string,
    shopId: string,
  ): Promise<TaskPlan[]> {
    const existing = await context.db
      .prepare(
        `
          SELECT synced_at FROM etsy_api_shops WHERE shop_id=?
        `,
      )
      .bind(shopId)
      .first<{ synced_at: string | null }>();
    const syncedAt = Date.parse(existing?.synced_at ?? "");
    if (Number.isFinite(syncedAt) && context.now.getTime() - syncedAt < SHOP_FRESHNESS_MS) {
      // Fresh shop row — skip refetch; planReadyResources marks resource completed.
      return [];
    }
    return [{
      resource: this.resource,
      adapterVersion: this.version,
      strategy: this.strategy,
      idempotencyKey: deterministicTaskKey(
        runId,
        this.resource,
        this.strategy,
        null,
        null,
        0,
      ),
      pageSize: 1,
    }];
  }

  async fetchPage(context: AdapterContext, task: SyncTask): Promise<AdapterPage<EtsyShop>> {
    const response = await etsyFetch<EtsyShop>(
      context.env,
      task.shopId,
      `/v3/application/shops/${task.shopId}`,
    );
    return {
      records: [response.body],
      responseCount: 1,
      nextCursor: null,
      pageKey: `${this.resource}:singleton`,
      ...readEtsyRateHeaders(response.headers),
    };
  }

  async persistPage(
    context: AdapterContext,
    _task: SyncTask,
    page: AdapterPage<EtsyShop>,
  ): Promise<PersistCounts> {
    const shop = page.records[0];
    if (!shop) return { source: 0, fetched: 0, inserted: 0, updated: 0, unchanged: 0 };
    const existing = await context.db
      .prepare("SELECT shop_id FROM etsy_api_shops WHERE shop_id=?")
      .bind(String(shop.shop_id))
      .first();
    await upsertShop(context.db, shop);
    return {
      source: 1,
      fetched: 1,
      inserted: existing ? 0 : 1,
      updated: existing ? 1 : 0,
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

export class ShopSectionsAdapter implements EtsyResourceAdapter<EtsyShopSection> {
  readonly resource = "shop_sections";
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
      cursor: { mode: "full" },
      pageOffset: 0,
      pageSize: 100,
    }];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<EtsyShopSection>> {
    const pageSize = normalizePageSize(task.pageSize);
    const response = await etsyFetch<EtsyListResponse<EtsyShopSection>>(
      context.env,
      task.shopId,
      `/v3/application/shops/${task.shopId}/sections`,
      new URLSearchParams({ limit: String(pageSize), offset: String(task.pageOffset) }),
    );
    const records = response.body.results ?? [];
    const count = typeof response.body.count === "number" ? response.body.count : null;
    const nextOffset = task.pageOffset + records.length;
    const hasMore = count != null ? nextOffset < count : records.length === pageSize;
    return {
      records,
      responseCount: count,
      nextCursor: hasMore ? { mode: "full", offset: nextOffset } : null,
      pageKey: `${this.resource}:${task.pageOffset}`,
      ...readEtsyRateHeaders(response.headers),
    };
  }

  async persistPage(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<EtsyShopSection>,
  ): Promise<PersistCounts> {
    const ids = page.records.map((section) => String(section.shop_section_id));
    const existing = ids.length
      ? await context.db
          .prepare(
            `
              SELECT shop_section_id FROM etsy_api_shop_sections
              WHERE shop_section_id IN (
                SELECT CAST(value AS TEXT) FROM json_each(?)
              )
            `,
          )
          .bind(JSON.stringify(ids))
          .all<{ shop_section_id: string }>()
      : { results: [] };
    const found = new Set((existing.results ?? []).map((row) => row.shop_section_id));
    const records = page.records.map((section) => ({
      sectionId: String(section.shop_section_id),
      shopId: task.shopId,
      title: section.title ?? "",
      rank: section.rank ?? null,
      activeListingCount: section.active_listing_count ?? null,
    }));
    if (records.length) {
      await context.db
        .prepare(
          `
            INSERT INTO etsy_api_shop_sections (
              shop_section_id, shop_id, title, rank, active_listing_count, synced_at
            )
            SELECT
              json_extract(value,'$.sectionId'), json_extract(value,'$.shopId'),
              json_extract(value,'$.title'), json_extract(value,'$.rank'),
              json_extract(value,'$.activeListingCount'), CURRENT_TIMESTAMP
            FROM json_each(?) WHERE 1
            ON CONFLICT(shop_section_id) DO UPDATE SET
              shop_id=excluded.shop_id, title=excluded.title, rank=excluded.rank,
              active_listing_count=excluded.active_listing_count,
              synced_at=CURRENT_TIMESTAMP
          `,
        )
        .bind(JSON.stringify(records))
        .run();
    }
    const inserted = ids.filter((id) => !found.has(id)).length;
    return {
      source: ids.length,
      fetched: ids.length,
      inserted,
      updated: ids.length - inserted,
      unchanged: 0,
    };
  }

  async planNext(): Promise<TaskPlan[]> {
    return [];
  }

  async finalize(context: AdapterContext, runId: string, shopId: string): Promise<void> {
    await context.db
      .prepare(
        `
          DELETE FROM etsy_api_shop_sections
          WHERE shop_id=? AND datetime(synced_at) < datetime((
            SELECT created_at FROM etsy_sync_jobs WHERE id=?
          ))
        `,
      )
      .bind(shopId, runId)
      .run();
  }

  retryPolicy(error: unknown, attempt: number) {
    if (error instanceof EtsyApiError) return retryDecision(error, attempt);
    return retryDecision(error, attempt);
  }
}

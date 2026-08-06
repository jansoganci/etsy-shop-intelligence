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
import type { EtsyListResponse, EtsyListingInventory } from "../types";

export class ListingInventoryAdapter
  implements EtsyResourceAdapter<EtsyListingInventory>
{
  readonly resource = "listing_inventory";
  readonly version = 2;
  readonly strategy = "batch_by_id" as const;
  readonly dependencies = ["listings"] as const;
  readonly deletionPolicy = "parent_snapshot" as const;

  async planInitial(
    _context: AdapterContext,
    runId: string,
  ): Promise<TaskPlan[]> {
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
      cursor: { afterListingId: null },
      pageOffset: 0,
      pageSize: 100,
    }];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<EtsyListingInventory>> {
    const pageSize = normalizePageSize(task.pageSize);
    const afterListingId =
      typeof task.cursor.afterListingId === "string" ? task.cursor.afterListingId : null;
    const rows = await context.db
      .prepare(
        `
          SELECT listing_id FROM etsy_api_listings
          WHERE shop_id=?
            AND (? IS NULL OR listing_id > ?)
          ORDER BY listing_id
          LIMIT ?
        `,
      )
      .bind(task.shopId, afterListingId, afterListingId, pageSize)
      .all<{ listing_id: string }>();
    const listingIds = (rows.results ?? []).map((row) => row.listing_id);
    if (listingIds.length === 0) {
      return {
        records: [],
        responseCount: null,
        nextCursor: { afterListingId, complete: true },
        pageKey: `${this.resource}:${afterListingId ?? "start"}`,
        qpsLimit: null,
        qpsRemaining: null,
        qpdLimit: null,
        qpdRemaining: null,
      };
    }
    const response = await etsyFetch<EtsyListResponse<EtsyListingInventory>>(
      context.env,
      task.shopId,
      "/v3/application/listings/batch/inventory",
      new URLSearchParams({ listing_ids: listingIds.join(",") }),
    );
    const lastId = listingIds[listingIds.length - 1];
    const hasMore = listingIds.length === pageSize;
    return {
      records: response.body.results ?? [],
      responseCount: null,
      nextCursor: {
        afterListingId: lastId,
        offset: task.pageOffset + listingIds.length,
        ...(hasMore ? {} : { complete: true }),
      },
      pageKey: `${this.resource}:${afterListingId ?? "start"}`,
      ...readEtsyRateHeaders(response.headers),
    };
  }

  async persistPage(
    context: AdapterContext,
    _task: SyncTask,
    page: AdapterPage<EtsyListingInventory>,
  ): Promise<PersistCounts> {
    const ids = page.records.map((record) => String(record.listing_id));
    const existingRows = ids.length
      ? await context.db
          .prepare(
            `
              SELECT listing_id FROM etsy_api_listing_inventory
              WHERE listing_id IN (
                SELECT CAST(value AS TEXT) FROM json_each(?)
              )
            `,
          )
          .bind(JSON.stringify(ids))
          .all<{ listing_id: string }>()
      : { results: [] };
    const existing = new Set(
      (existingRows.results ?? []).map((row) => row.listing_id),
    );
    const records = page.records.map((record) => {
      const inventory = record.inventory ?? {};
      return {
        listingId: String(record.listing_id),
        products: inventory.products ?? [],
        priceOnProperty: inventory.price_on_property ?? [],
        quantityOnProperty: inventory.quantity_on_property ?? [],
        skuOnProperty: inventory.sku_on_property ?? [],
      };
    });
    if (records.length) {
      await context.db
        .prepare(
          `
            INSERT INTO etsy_api_listing_inventory (
              listing_id, products_json, price_on_property_json,
              quantity_on_property_json, sku_on_property_json, synced_at
            )
            SELECT
              json_extract(value,'$.listingId'),
              json(json_extract(value,'$.products')),
              json(json_extract(value,'$.priceOnProperty')),
              json(json_extract(value,'$.quantityOnProperty')),
              json(json_extract(value,'$.skuOnProperty')),
              CURRENT_TIMESTAMP
            FROM json_each(?) WHERE 1
            ON CONFLICT(listing_id) DO UPDATE SET
              products_json=excluded.products_json,
              price_on_property_json=excluded.price_on_property_json,
              quantity_on_property_json=excluded.quantity_on_property_json,
              sku_on_property_json=excluded.sku_on_property_json,
              synced_at=CURRENT_TIMESTAMP
          `,
        )
        .bind(JSON.stringify(records))
        .run();
    }
    const inserted = ids.filter((id) => !existing.has(id)).length;
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

  retryPolicy(error: unknown, attempt: number) {
    return retryDecision(error, attempt);
  }
}

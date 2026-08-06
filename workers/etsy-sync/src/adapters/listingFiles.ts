import { EtsyApiError, etsyFetch } from "../etsy";
import { deterministicTaskKey } from "../engine/planner";
import { readEtsyRateHeaders, retryDecision, type EtsyRateHeaders } from "../engine/rateLimit";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  PersistCounts,
  SyncTask,
  TaskPlan,
} from "../engine/types";
import type {
  D1PreparedStatement,
  EtsyListResponse,
  EtsyListingFile,
} from "../types";
import { NO_RATE_HEADERS } from "./common";

type ListingFilesPage = {
  listingId: string;
  files: EtsyListingFile[];
};

function mergeRates(current: EtsyRateHeaders, next: EtsyRateHeaders): EtsyRateHeaders {
  const minimum = (a: number | null, b: number | null) =>
    a == null ? b : b == null ? a : Math.min(a, b);
  return {
    qpsLimit: next.qpsLimit ?? current.qpsLimit,
    qpsRemaining: minimum(current.qpsRemaining, next.qpsRemaining),
    qpdLimit: next.qpdLimit ?? current.qpdLimit,
    qpdRemaining: minimum(current.qpdRemaining, next.qpdRemaining),
  };
}

export class ListingFilesAdapter implements EtsyResourceAdapter<ListingFilesPage> {
  readonly resource = "listing_files";
  readonly version = 2;
  readonly strategy = "parent_fanout" as const;
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
      idempotencyKey: deterministicTaskKey(runId, this.resource, this.strategy, null, null, 0),
      cursor: { parentBatchSize: 3, afterListingId: null },
      pageOffset: 0,
      pageSize: 3,
    }];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<ListingFilesPage>> {
    const batchSize = Math.max(1, Math.min(3, task.pageSize));
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
      .bind(task.shopId, afterListingId, afterListingId, batchSize)
      .all<{ listing_id: string }>();
    const parents = rows.results ?? [];
    const records: ListingFilesPage[] = [];
    let rate = { ...NO_RATE_HEADERS };
    for (const parent of parents) {
      try {
        const response = await etsyFetch<EtsyListResponse<EtsyListingFile>>(
          context.env,
          task.shopId,
          `/v3/application/shops/${task.shopId}/listings/${parent.listing_id}/files`,
        );
        records.push({
          listingId: parent.listing_id,
          files: response.body.results ?? [],
        });
        rate = mergeRates(rate, readEtsyRateHeaders(response.headers));
      } catch (error) {
        // Physical listings legitimately have no downloadable-file resource.
        if (!(error instanceof EtsyApiError) || error.status !== 404) throw error;
        records.push({ listingId: parent.listing_id, files: [] });
      }
    }
    const last = parents[parents.length - 1];
    const hasMore = parents.length === batchSize;
    return {
      records,
      responseCount: null,
      nextCursor: last
        ? {
            parentBatchSize: batchSize,
            afterListingId: last.listing_id,
            offset: task.pageOffset + parents.length,
            ...(hasMore ? {} : { complete: true }),
          }
        : { parentBatchSize: batchSize, afterListingId, complete: true },
      pageKey: `${this.resource}:${afterListingId ?? "start"}`,
      ...rate,
    };
  }

  async persistPage(
    context: AdapterContext,
    _task: SyncTask,
    page: AdapterPage<ListingFilesPage>,
  ): Promise<PersistCounts> {
    const statements: D1PreparedStatement[] = [];
    let fetched = 0;
    for (const record of page.records) {
      statements.push(
        context.db
          .prepare("DELETE FROM etsy_api_listing_files WHERE listing_id=?")
          .bind(record.listingId),
      );
      for (const file of record.files) {
        fetched += 1;
        statements.push(
          context.db
            .prepare(
              `
                INSERT INTO etsy_api_listing_files (
                  listing_file_id, listing_id, rank, filename, filesize,
                  size_bytes, filetype, created_timestamp, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(listing_file_id) DO UPDATE SET
                  listing_id=excluded.listing_id, rank=excluded.rank,
                  filename=excluded.filename, filesize=excluded.filesize,
                  size_bytes=excluded.size_bytes, filetype=excluded.filetype,
                  created_timestamp=excluded.created_timestamp,
                  synced_at=CURRENT_TIMESTAMP
              `,
            )
            .bind(
              String(file.listing_file_id),
              record.listingId,
              file.rank ?? null,
              file.filename ?? null,
              file.filesize ?? null,
              file.size_bytes ?? null,
              file.filetype ?? null,
              file.created_timestamp ?? file.create_timestamp ?? null,
            ),
        );
      }
    }
    if (statements.length) await context.db.batch(statements);
    return {
      source: fetched,
      fetched,
      inserted: 0,
      updated: fetched,
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

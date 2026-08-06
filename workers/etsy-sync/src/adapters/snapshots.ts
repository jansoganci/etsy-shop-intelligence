import { deterministicTaskKey } from "../engine/planner";
import { retryDecision } from "../engine/rateLimit";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  PersistCounts,
  SyncTask,
  TaskPlan,
} from "../engine/types";
import { NO_RATE_HEADERS } from "./common";

export class SnapshotsAdapter implements EtsyResourceAdapter<never> {
  readonly resource = "snapshots";
  readonly version = 1;
  readonly strategy = "local_derived" as const;
  readonly dependencies = ["listings"] as const;
  readonly deletionPolicy = "none" as const;

  async planInitial(
    _context: AdapterContext,
    runId: string,
  ): Promise<TaskPlan[]> {
    return [{
      resource: this.resource,
      adapterVersion: this.version,
      strategy: this.strategy,
      idempotencyKey: deterministicTaskKey(runId, this.resource, this.strategy, null, null, 0),
      pageSize: 1,
    }];
  }

  async fetchPage(
    _context: AdapterContext,
    _task: SyncTask,
  ): Promise<AdapterPage<never>> {
    return {
      records: [],
      responseCount: 0,
      nextCursor: null,
      pageKey: `${this.resource}:hour`,
      ...NO_RATE_HEADERS,
    };
  }

  async persistPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<PersistCounts> {
    const capturedAt = context.now.toISOString().slice(0, 13) + ":00:00.000Z";
    const result = await context.db
      .prepare(
        `
          INSERT OR IGNORE INTO etsy_listing_metric_snapshots (
            listing_id, captured_at, num_favorers, quantity, state
          )
          SELECT listing_id, ?, num_favorers, quantity, state
          FROM etsy_api_listings WHERE shop_id=?
        `,
      )
      .bind(capturedAt, task.shopId)
      .run();
    const count = Number(result.meta?.changes ?? 0);
    return { source: count, fetched: count, inserted: count, updated: 0, unchanged: 0 };
  }

  async planNext(): Promise<TaskPlan[]> {
    return [];
  }

  retryPolicy(error: unknown, attempt: number) {
    return retryDecision(error, attempt);
  }
}

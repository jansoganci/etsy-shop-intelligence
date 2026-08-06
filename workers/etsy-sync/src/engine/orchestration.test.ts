import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import type { Env } from "../types";
import { AdapterRegistry } from "./registry";
import { createJob } from "./repository";
import { finalizeReadyJobs, planReadyResources } from "./runtime";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  SyncTask,
  TaskPlan,
} from "./types";
import { deterministicTaskKey } from "./planner";
import { NO_RATE_HEADERS } from "../adapters/common";
import { ShopAdapter, ShopSectionsAdapter } from "../adapters/shop";
import { ListingsAdapter } from "../adapters/listings";
import { ListingInventoryAdapter } from "../adapters/inventory";
import { ListingFilesAdapter } from "../adapters/listingFiles";
import { SnapshotsAdapter } from "../adapters/snapshots";
import { ReceiptsAdapter } from "../adapters/receipts";
import { PaymentsAdapter } from "../adapters/payments";
import { LedgerEntriesAdapter } from "../adapters/ledger";
import { ReviewsAdapter } from "../adapters/reviews";

class FakeAdapter implements EtsyResourceAdapter {
  readonly version = 1;
  readonly strategy = "singleton" as const;
  readonly deletionPolicy = "none" as const;

  constructor(
    readonly resource: string,
    readonly dependencies: readonly string[],
  ) {}

  async planInitial(
    _context: AdapterContext,
    runId: string,
  ): Promise<TaskPlan[]> {
    return [{
      resource: this.resource,
      adapterVersion: 1,
      strategy: "singleton",
      idempotencyKey: deterministicTaskKey(runId, this.resource, "singleton", null, null, 0),
    }];
  }

  async fetchPage(): Promise<AdapterPage> {
    return {
      records: [],
      responseCount: 0,
      nextCursor: null,
      pageKey: "page",
      ...NO_RATE_HEADERS,
    };
  }

  async persistPage() {
    return { source: 0, fetched: 0, inserted: 0, updated: 0, unchanged: 0 };
  }

  async planNext(
    _context: AdapterContext,
    _task: SyncTask,
    _page: AdapterPage,
  ): Promise<TaskPlan[]> {
    return [];
  }

  retryPolicy() {
    return { action: "fail" as const, code: "test" };
  }
}

describe("resource dependency orchestration", () => {
  it("plans the full real adapter graph within the D1 query budget", async () => {
    const db = new FullSchemaTestD1();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_connections (
            shop_id,etsy_user_id,scopes_json,access_token_ciphertext,
            access_token_iv,refresh_token_ciphertext,refresh_token_iv,
            access_token_expires_at,status
          ) VALUES ('shop','user','[]','a','i','r','i','2099-01-01','connected')
        `,
      )
      .run();
    // Keep ledger incremental so this budget test still measures the public
    // graph shape, not cold epoch→now chunk expansion (Phase 4).
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_sync_cursors (
            shop_id, resource, cursor_key, cursor_value,
            last_success_at, initial_sync_completed_at
          ) VALUES (
            'shop', 'ledger_entries', 'last_modified', ?,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `,
      )
      .run(String(Math.floor(Date.UTC(2026, 6, 25) / 1000)));
    const registry = new AdapterRegistry()
      .register(new ShopAdapter())
      .register(new ShopSectionsAdapter())
      .register(new ListingsAdapter())
      .register(new ListingInventoryAdapter())
      .register(new ListingFilesAdapter())
      .register(new SnapshotsAdapter())
      .register(new ReceiptsAdapter())
      .register(new PaymentsAdapter())
      .register(new LedgerEntriesAdapter())
      .register(new ReviewsAdapter());
    // Full adapter graph (pre-Commerce "all" shape). Keep this explicit so the
    // orchestration budget test still covers every registered adapter after
    // public RequestedResource dropped "all".
    const resources = [
      "shop",
      "shop_sections",
      "listings",
      "listing_inventory",
      "listing_files",
      "snapshots",
      "receipts",
      "payments",
      "ledger_entries",
      "reviews",
    ];
    await createJob(db, {
      runId: "all-run",
      shopId: "shop",
      requestedResource: "all",
      resources: resources.map((resource, ordinal) => ({
        resource,
        adapterVersion: 1,
        ordinal,
      })),
    });
    const env = {
      DB: db,
      ETSY_SYNC_QUEUE: { send: async () => undefined },
    } as unknown as Env;
    expect(await planReadyResources(env, registry, "all-run")).toBe(1);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='completed'
          WHERE run_id='all-run' AND resource='shop'
        `,
      )
      .run();
    expect(
      await planReadyResources(
        env,
        registry,
        "all-run",
        new Date("2026-07-26T00:00:00Z"),
      ),
    ).toBe(5);
    const total = db.sqlite
      .prepare("SELECT total_tasks FROM etsy_sync_jobs WHERE id='all-run'")
      .get() as { total_tasks: number };
    expect(total.total_tasks).toBe(6);
    expect(
      db.sqlite
        .prepare(
          `
            SELECT resource,status FROM etsy_sync_job_resources
            WHERE run_id='all-run' ORDER BY ordinal
          `,
        )
        .all(),
    ).toEqual([
      { resource: "shop", status: "completed" },
      { resource: "shop_sections", status: "queued" },
      { resource: "listings", status: "queued" },
      { resource: "listing_inventory", status: "pending" },
      { resource: "listing_files", status: "pending" },
      { resource: "snapshots", status: "pending" },
      { resource: "receipts", status: "queued" },
      { resource: "payments", status: "pending" },
      { resource: "ledger_entries", status: "queued" },
      { resource: "reviews", status: "queued" },
    ]);
  });

  it("plans dependencies in order and completes only the full generation", async () => {
    const db = new FullSchemaTestD1();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_connections (
            shop_id,etsy_user_id,scopes_json,access_token_ciphertext,
            access_token_iv,refresh_token_ciphertext,refresh_token_iv,
            access_token_expires_at,status
          ) VALUES ('shop','user','[]','a','i','r','i','2099-01-01','connected')
        `,
      )
      .run();
    const registry = new AdapterRegistry()
      .register(new FakeAdapter("shop", []))
      .register(new FakeAdapter("listings", ["shop"]))
      .register(new FakeAdapter("listing_files", ["listings"]));
    await createJob(db, {
      runId: "run",
      shopId: "shop",
      requestedResource: "listings",
      resources: [
        { resource: "shop", adapterVersion: 1, ordinal: 0 },
        { resource: "listings", adapterVersion: 1, ordinal: 1 },
        { resource: "listing_files", adapterVersion: 1, ordinal: 2 },
      ],
    });
    const env = {
      DB: db,
      ETSY_SYNC_QUEUE: { send: async () => undefined },
    } as unknown as Env;

    expect(await planReadyResources(env, registry, "run")).toBe(1);
    expect(
      db.sqlite
        .prepare("SELECT resource,status FROM etsy_sync_job_resources ORDER BY ordinal")
        .all(),
    ).toEqual([
      { resource: "shop", status: "queued" },
      { resource: "listings", status: "pending" },
      { resource: "listing_files", status: "pending" },
    ]);

    for (const resource of ["shop", "listings", "listing_files"]) {
      db.sqlite
        .prepare(
          `
            UPDATE etsy_sync_tasks SET status='completed',
              completed_at=CURRENT_TIMESTAMP
            WHERE run_id='run' AND resource=?
          `,
        )
        .run(resource);
      await finalizeReadyJobs(env, registry, new Date("2026-07-26T00:00:00Z"), "run");
      const job = db.sqlite
        .prepare("SELECT status FROM etsy_sync_jobs WHERE id='run'")
        .get() as { status: string };
      expect(job.status).toBe(
        resource === "listing_files" ? "completed" : "queued",
      );
    }
    expect(
      db.sqlite
        .prepare("SELECT status FROM etsy_reconciliation_generations WHERE run_id='run'")
        .get(),
    ).toEqual({ status: "queued" });
  });
});

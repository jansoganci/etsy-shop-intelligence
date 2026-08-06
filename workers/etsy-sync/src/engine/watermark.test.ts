import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import { AdapterRegistry } from "./registry";
import {
  claimTask,
  commitPage,
  createJob,
  createTasks,
} from "./repository";
import { finalizeReadyJobs } from "./runtime";
import { ReceiptsAdapter } from "../adapters/receipts";
import { ShopAdapter } from "../adapters/shop";
import type { Env } from "../types";
import { NO_RATE_HEADERS } from "../adapters/common";

describe("receipts watermark durability", () => {
  it("persists maxSeenTimestamp through the final page commit into etsy_sync_cursors", async () => {
    const db = new FullSchemaTestD1();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_connections (
            shop_id, etsy_user_id, scopes_json,
            access_token_ciphertext, access_token_iv,
            refresh_token_ciphertext, refresh_token_iv,
            access_token_expires_at, status
          ) VALUES ('shop','user','[]','a','i','r','i','2099-01-01','connected')
        `,
      )
      .run();
    await createJob(db, {
      runId: "run",
      shopId: "shop",
      requestedResource: "sales",
      resources: [
        { resource: "shop", adapterVersion: 1, ordinal: 0 },
        { resource: "receipts", adapterVersion: 1, ordinal: 1 },
      ],
    });
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='completed',
            completed_at=CURRENT_TIMESTAMP WHERE run_id='run' AND resource='shop'
        `,
      )
      .run();
    await createTasks(db, "run", [
      {
        resource: "receipts",
        adapterVersion: 1,
        strategy: "time_windowed",
        idempotencyKey: "run:receipts:window",
        // Use incremental mode so planFinal does not schedule a catchup task.
        cursor: { filter: "modified", mode: "incremental", maxSeenTimestamp: 0 },
        segmentStart: 1_700_000_000,
        segmentEnd: 1_800_000_000,
        pageOffset: 0,
        pageSize: 100,
      },
    ]);

    const now = new Date("2026-07-26T12:00:00Z");
    const taskId = db.sqlite
      .prepare("SELECT id FROM etsy_sync_tasks WHERE run_id='run' AND resource='receipts'")
      .get<{ id: string }>()!.id;
    const claimed = await claimTask(db, taskId, "run", now, 900);
    expect(claimed).not.toBeNull();

    // Simulate runtime after stripping `complete: true` — watermark retained.
    await commitPage(
      db,
      claimed!,
      {
        records: [],
        responseCount: 1,
        nextCursor: null,
        pageKey: "receipts:final",
        ...NO_RATE_HEADERS,
      },
      { source: 1, fetched: 1, inserted: 1, updated: 0, unchanged: 0 },
      {
        done: true,
        nextCursor: {
          filter: "modified",
          mode: "incremental",
          maxSeenTimestamp: 1_800_000_000,
          offset: 1,
        },
        nextOffset: 1,
      },
    );

    const cursorJson = db.sqlite
      .prepare("SELECT cursor_json, status FROM etsy_sync_tasks WHERE id=?")
      .get<{ cursor_json: string; status: string }>(taskId);
    expect(cursorJson?.status).toBe("completed");
    expect(JSON.parse(cursorJson!.cursor_json)).toMatchObject({
      maxSeenTimestamp: 1_800_000_000,
    });

    const registry = new AdapterRegistry()
      .register(new ShopAdapter())
      .register(new ReceiptsAdapter());
    const env = { DB: db } as unknown as Env;
    await finalizeReadyJobs(env, registry, now, "run");

    const salesCursor = db.sqlite
      .prepare(
        `
          SELECT cursor_value FROM etsy_sync_cursors
          WHERE shop_id='shop' AND resource='sales' AND cursor_key='last_modified'
        `,
      )
      .get<{ cursor_value: string }>();
    expect(salesCursor?.cursor_value).toBe("1800000000");
  });
});

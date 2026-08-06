import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import { AdapterRegistry } from "./registry";
import {
  claimTask,
  commitPage,
  createJob,
  createTasks,
  loadJobWindow,
} from "./repository";
import { finalizeReadyJobs } from "./runtime";
import { ReceiptsAdapter } from "../adapters/receipts";
import { ShopAdapter } from "../adapters/shop";
import type { Env } from "../types";
import { NO_RATE_HEADERS } from "../adapters/common";

async function seedSalesJob(
  db: FullSchemaTestD1,
  options: { runId: string; isPeriodRun: boolean; periodToTs?: number },
): Promise<string> {
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
    runId: options.runId,
    shopId: "shop",
    requestedResource: "sales",
    resources: [
      { resource: "shop", adapterVersion: 1, ordinal: 0 },
      { resource: "receipts", adapterVersion: 1, ordinal: 1 },
    ],
  });
  if (options.isPeriodRun) {
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_jobs
          SET is_period_run = 1,
              period_from_ts = 1700000000,
              period_to_ts = ?
          WHERE id = ?
        `,
      )
      .run(options.periodToTs ?? 1750000000, options.runId);
  }
  db.sqlite
    .prepare(
      `
        UPDATE etsy_sync_job_resources SET status='completed',
          completed_at=CURRENT_TIMESTAMP WHERE run_id=? AND resource='shop'
      `,
    )
    .run(options.runId);
  await createTasks(db, options.runId, [
    {
      resource: "receipts",
      adapterVersion: 1,
      strategy: "time_windowed",
      idempotencyKey: `${options.runId}:receipts:window`,
      cursor: { filter: "modified", mode: "incremental", maxSeenTimestamp: 0 },
      segmentStart: 1_700_000_000,
      segmentEnd: 1_800_000_000,
      pageOffset: 0,
      pageSize: 100,
    },
  ]);
  return db.sqlite
    .prepare(
      "SELECT id FROM etsy_sync_tasks WHERE run_id=? AND resource='receipts'",
    )
    .get<{ id: string }>(options.runId)!.id;
}

async function completeReceiptsTask(
  db: FullSchemaTestD1,
  env: Env,
  runId: string,
  taskId: string,
  maxSeenTimestamp: number,
): Promise<void> {
  const now = new Date("2026-08-05T12:00:00Z");
  const claimed = await claimTask(db, taskId, runId, now, 900);
  expect(claimed).not.toBeNull();
  expect(claimed!.isPeriodRun).toBe(
    Number(
      db.sqlite
        .prepare("SELECT is_period_run FROM etsy_sync_jobs WHERE id=?")
        .get<{ is_period_run: number }>(runId)?.is_period_run,
    ) === 1,
  );

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
        maxSeenTimestamp,
        offset: 1,
      },
      nextOffset: 1,
    },
  );

  const registry = new AdapterRegistry()
    .register(new ShopAdapter())
    .register(new ReceiptsAdapter());
  await finalizeReadyJobs(env, registry, now, runId);
}

describe("period-run watermark isolation", () => {
  it("loadJobWindow reports is_period_run and window columns from 0025", async () => {
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
      runId: "run-window",
      shopId: "shop",
      requestedResource: "sales",
      resources: [{ resource: "shop", adapterVersion: 1, ordinal: 0 }],
    });
    const inert = await loadJobWindow(db, "run-window");
    expect(inert).toMatchObject({
      runId: "run-window",
      shopId: "shop",
      isPeriodRun: false,
      periodFromTs: null,
      periodToTs: null,
    });

    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_jobs
          SET is_period_run=1, period_from_ts=100, period_to_ts=200
          WHERE id='run-window'
        `,
      )
      .run();
    const period = await loadJobWindow(db, "run-window");
    expect(period).toMatchObject({
      isPeriodRun: true,
      periodFromTs: 100,
      periodToTs: 200,
    });
  });

  it("finalizeReadyJobs with is_period_run=1 leaves etsy_sync_cursors untouched", async () => {
    const db = new FullSchemaTestD1();
    const runId = "run-period";
    const taskId = await seedSalesJob(db, {
      runId,
      isPeriodRun: true,
      periodToTs: 1_750_000_000,
    });
    const env = { DB: db } as unknown as Env;
    // Far-future maxSeen on the task must still not write a cursor.
    await completeReceiptsTask(db, env, runId, taskId, 1_900_000_000);

    const cursors = db.sqlite
      .prepare("SELECT COUNT(*) AS n FROM etsy_sync_cursors")
      .get<{ n: number }>();
    expect(cursors?.n).toBe(0);

    const resource = db.sqlite
      .prepare(
        `
          SELECT status FROM etsy_sync_job_resources
          WHERE run_id=? AND resource='receipts'
        `,
      )
      .get<{ status: string }>(runId);
    expect(resource?.status).toBe("completed");
  });

  it("finalizeReadyJobs with is_period_run=0 still writes the sales cursor", async () => {
    const db = new FullSchemaTestD1();
    const runId = "run-incremental";
    const taskId = await seedSalesJob(db, { runId, isPeriodRun: false });
    const env = { DB: db } as unknown as Env;
    await completeReceiptsTask(db, env, runId, taskId, 1_800_000_000);

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

  it("a period receipt maxSeen past period_to_ts does not move the cursor", async () => {
    const db = new FullSchemaTestD1();
    const runId = "run-period-future";
    const periodToTs = 1_750_000_000;
    const taskId = await seedSalesJob(db, {
      runId,
      isPeriodRun: true,
      periodToTs,
    });
    // Seed a prior incremental watermark that must remain unchanged.
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_sync_cursors (
            shop_id, resource, cursor_key, cursor_value, last_success_at
          ) VALUES ('shop', 'sales', 'last_modified', '1700000100', CURRENT_TIMESTAMP)
        `,
      )
      .run();

    const env = { DB: db } as unknown as Env;
    await completeReceiptsTask(db, env, runId, taskId, periodToTs + 86_400);

    const salesCursor = db.sqlite
      .prepare(
        `
          SELECT cursor_value FROM etsy_sync_cursors
          WHERE shop_id='shop' AND resource='sales' AND cursor_key='last_modified'
        `,
      )
      .get<{ cursor_value: string }>();
    expect(salesCursor?.cursor_value).toBe("1700000100");
  });
});

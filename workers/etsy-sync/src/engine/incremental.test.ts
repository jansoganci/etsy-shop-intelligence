import { describe, expect, it } from "vitest";
import worker from "../index";
import { FullSchemaTestD1 } from "../test/testD1";
import type { Env } from "../types";
import {
  SOFT_QUEUE_OPS_DAY,
  createJob,
  createTasks,
  recoverStaleTasks,
  softBudgetBlocks,
} from "./repository";
import { finalizeReadyJobs } from "./runtime";
import { AdapterRegistry } from "./registry";
import { ReceiptsAdapter } from "../adapters/receipts";

function testEnv(db: FullSchemaTestD1): Env {
  return {
    DB: db,
    ETSY_API_KEY: "key",
    ETSY_SHARED_SECRET: "secret",
    ETSY_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    ETSY_BUYER_HMAC_SECRET: "hmac",
    ETSY_REDIRECT_URI: "https://example.com/callback",
    ETSY_SYNC_QUEUE: { send: async () => undefined },
  } as unknown as Env;
}

function seedConnection(db: FullSchemaTestD1): void {
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
}

describe("incremental commerce and budget recovery", () => {
  it("starts an incremental job on the 03:00 cron only", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const env = testEnv(db);

    await worker.scheduled(
      { cron: "*/5 * * * *", scheduledTime: 0, noRetry() {} } as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_sync_jobs WHERE requested_resource='commerce'")
        .get<{ c: number }>()?.c,
    ).toBe(0);

    await worker.scheduled(
      { cron: "0 3 * * *", scheduledTime: 0, noRetry() {} } as ScheduledController,
      env,
      {} as ExecutionContext,
    );
    const job = db.sqlite
      .prepare(
        `
          SELECT requested_resource, is_period_run, period_from_ts, period_to_ts, status
          FROM etsy_sync_jobs WHERE requested_resource='commerce' LIMIT 1
        `,
      )
      .get<{
        requested_resource: string;
        is_period_run: number;
        period_from_ts: number | null;
        period_to_ts: number | null;
        status: string;
      }>();
    expect(job).toMatchObject({
      requested_resource: "commerce",
      is_period_run: 0,
      period_from_ts: null,
      period_to_ts: null,
    });
    expect(["queued", "running"]).toContain(job?.status);
  });

  it("skips incremental start while a manual job is active", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    await createJob(db, {
      runId: "manual",
      shopId: "shop",
      requestedResource: "commerce",
      isPeriodRun: true,
      periodFromTs: 1,
      periodToTs: 2,
      resources: [{ resource: "shop", adapterVersion: 1, ordinal: 0 }],
    });
    await worker.scheduled(
      { cron: "0 3 * * *", scheduledTime: 0, noRetry() {} } as ScheduledController,
      testEnv(db),
      {} as ExecutionContext,
    );
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_sync_jobs")
        .get<{ c: number }>()?.c,
    ).toBe(1);
  });

  it("incremental finalize writes cursors; period finalize writes no coverage", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const registry = new AdapterRegistry().register(new ReceiptsAdapter());

    await createJob(db, {
      runId: "incr",
      shopId: "shop",
      requestedResource: "commerce",
      isPeriodRun: false,
      resources: [{ resource: "receipts", adapterVersion: 1, ordinal: 0 }],
    });
    await createTasks(db, "incr", [
      {
        resource: "receipts",
        adapterVersion: 1,
        strategy: "time_windowed",
        idempotencyKey: "incr:receipts",
        cursor: { maxSeenTimestamp: 1_800_000_000, mode: "incremental" },
        segmentStart: 1,
        segmentEnd: 2,
      },
    ]);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP,
            cursor_json=?
          WHERE run_id='incr'
        `,
      )
      .run(JSON.stringify({ maxSeenTimestamp: 1_800_000_000, mode: "incremental" }));
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='queued'
          WHERE run_id='incr' AND resource='receipts'
        `,
      )
      .run();
    await finalizeReadyJobs(testEnv(db), registry, new Date(), "incr");
    expect(
      db.sqlite
        .prepare(
          `
            SELECT cursor_value FROM etsy_sync_cursors
            WHERE shop_id='shop' AND resource='sales'
          `,
        )
        .get<{ cursor_value: string }>()?.cursor_value,
    ).toBe("1800000000");
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_commerce_period_coverage")
        .get<{ c: number }>()?.c,
    ).toBe(0);

    await createJob(db, {
      runId: "period",
      shopId: "shop",
      requestedResource: "commerce",
      isPeriodRun: true,
      periodFromTs: Date.UTC(2026, 6, 1) / 1000,
      periodToTs: Date.UTC(2026, 7, 1) / 1000,
      resources: [{ resource: "receipts", adapterVersion: 1, ordinal: 0 }],
    });
    await createTasks(db, "period", [
      {
        resource: "receipts",
        adapterVersion: 1,
        strategy: "time_windowed",
        idempotencyKey: "period:receipts",
        cursor: { maxSeenTimestamp: 1_900_000_000, mode: "manual_period" },
        segmentStart: 1,
        segmentEnd: 2,
      },
    ]);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP,
            cursor_json=?
          WHERE run_id='period'
        `,
      )
      .run(JSON.stringify({ maxSeenTimestamp: 1_900_000_000, mode: "manual_period" }));
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='queued'
          WHERE run_id='period' AND resource='receipts'
        `,
      )
      .run();
    const cursorBefore = db.sqlite
      .prepare(
        `
          SELECT cursor_value FROM etsy_sync_cursors
          WHERE shop_id='shop' AND resource='sales'
        `,
      )
      .get<{ cursor_value: string }>()?.cursor_value;
    await finalizeReadyJobs(testEnv(db), registry, new Date(), "period");
    expect(
      db.sqlite
        .prepare(
          `
            SELECT cursor_value FROM etsy_sync_cursors
            WHERE shop_id='shop' AND resource='sales'
          `,
        )
        .get<{ cursor_value: string }>()?.cursor_value,
    ).toBe(cursorBefore);
  });

  it("re-enqueues an orphaned queued task older than 30 minutes once", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    await createJob(db, {
      runId: "run",
      shopId: "shop",
      requestedResource: "shop",
      resources: [{ resource: "shop", adapterVersion: 1, ordinal: 0 }],
    });
    await createTasks(db, "run", [
      {
        resource: "shop",
        adapterVersion: 1,
        strategy: "singleton",
        idempotencyKey: "run:shop",
        cursor: {},
        segmentStart: null,
        segmentEnd: null,
      },
    ]);
    const taskId = db.sqlite
      .prepare("SELECT id FROM etsy_sync_tasks WHERE run_id='run'")
      .get<{ id: string }>()!.id;
    // Simulate Queue retention drop: task stays queued, outbox already drained.
    db.sqlite.prepare("DELETE FROM etsy_sync_outbox WHERE task_id=?").run(taskId);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks
          SET status='queued', lease_token=NULL, next_attempt_at=NULL,
              updated_at=?
          WHERE id=?
        `,
      )
      .run("2026-07-25T11:00:00.000Z", taskId);

    const first = await recoverStaleTasks(db, new Date("2026-07-25T12:00:00Z"));
    expect(first).toBe(1);
    const outboxCount = db.sqlite
      .prepare("SELECT COUNT(*) AS c FROM etsy_sync_outbox WHERE task_id=?")
      .get<{ c: number }>(taskId)?.c;
    expect(outboxCount).toBe(1);

    // Still pending outbox → second recovery must not select the orphan again.
    const second = await recoverStaleTasks(db, new Date("2026-07-25T12:05:00Z"));
    expect(second).toBe(0);
  });

  it("softBudgetBlocks at the new threshold", async () => {
    const db = new FullSchemaTestD1();
    const dayKey = "2026-07-25";
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_sync_soft_budget_day (
            day_key, queue_ops, d1_write_ops
          ) VALUES (?, ?, 0)
        `,
      )
      .run(dayKey, SOFT_QUEUE_OPS_DAY);
    const blocked = await softBudgetBlocks(
      db,
      new Date("2026-07-25T12:00:00Z"),
    );
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBeTruthy();
  });
});

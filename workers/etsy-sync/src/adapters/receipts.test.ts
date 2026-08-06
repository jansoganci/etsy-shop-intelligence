import { describe, expect, it } from "vitest";
import { ReceiptsAdapter } from "./receipts";
import { FullSchemaTestD1 } from "../test/testD1";
import { createJob } from "../engine/repository";
import type { AdapterPage, SyncTask } from "../engine/types";
import type { Env, EtsyReceipt } from "../types";

function receipt(id: number): EtsyReceipt {
  return {
    receipt_id: id,
    buyer_user_id: id + 100,
    created_timestamp: 1_700_000_000 + id,
    updated_timestamp: 1_700_000_100 + id,
    status: "paid",
    grandtotal: { amount: 2500, divisor: 100, currency_code: "USD" },
    transactions: [
      {
        transaction_id: id * 10,
        receipt_id: id,
        title: `Item ${id}`,
        quantity: 1,
        price: { amount: 2500, divisor: 100, currency_code: "USD" },
      },
    ],
    refunds:
      id === 2
        ? [
            {
              amount: { amount: 500, divisor: 100, currency_code: "USD" },
              created_timestamp: 1_700_000_200,
              status: "completed",
            },
          ]
        : [],
  };
}

function task(): SyncTask {
  return {
    id: "task",
    runId: "run",
    shopId: "shop",
    resource: "receipts",
    adapterVersion: 1,
    strategy: "time_windowed",
    idempotencyKey: "key",
    status: "running",
    cursor: { filter: "created", mode: "backfill" },
    segmentStart: 1_700_000_000,
    segmentEnd: 1_800_000_000,
    pageOffset: 0,
    pageSize: 100,
    expectedCount: 2,
    attemptCount: 1,
    maxAttempts: 12,
    leaseToken: "lease",
    isPeriodRun: false,
    periodFromTs: null,
    periodToTs: null,
  };
}

function context(db: FullSchemaTestD1, now = new Date("2026-07-25T12:00:00Z")) {
  const env = {
    DB: db,
    ETSY_BUYER_HMAC_SECRET: "unit-test-hmac-key",
  } as unknown as Env;
  return { env, db, now };
}

describe("Receipts production adapter", () => {
  it("persists a full 100-receipt page within five D1 queries", async () => {
    const db = new FullSchemaTestD1();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_shops (
            shop_id, user_id, shop_name, title, announcement, currency_code,
            synced_at
          ) VALUES ('shop','user','Shop','','','USD',CURRENT_TIMESTAMP)
        `,
      )
      .run();
    const records = Array.from({ length: 100 }, (_, index) => receipt(index + 1));
    const adapter = new ReceiptsAdapter();
    const env = {
      DB: db,
      ETSY_BUYER_HMAC_SECRET: "unit-test-hmac-key",
    } as unknown as Env;
    const before = db.preparedQueries.length;
    const result = await adapter.persistPage(
      { env, db, now: new Date("2026-07-25T12:00:00Z") },
      task(),
      {
        records,
        responseCount: 100,
        nextCursor: null,
        pageKey: "receipts:full-page",
        qpsLimit: 10,
        qpsRemaining: 9,
        qpdLimit: 10_000,
        qpdRemaining: 9_999,
      },
    );

    expect(result).toMatchObject({
      source: 100,
      fetched: 200,
      inserted: 100,
    });
    expect(db.preparedQueries.length - before).toBe(5);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_receipts").get(),
    ).toEqual({ count: 100 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_transactions").get(),
    ).toEqual({ count: 100 });
  });

  it("batch-upserts a small receipt page with transactions and refunds", async () => {
    const db = new FullSchemaTestD1();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_shops (
            shop_id, user_id, shop_name, title, announcement, currency_code,
            synced_at
          ) VALUES ('shop','user','Shop','','','USD',CURRENT_TIMESTAMP)
        `,
      )
      .run();
    const records = [receipt(1), receipt(2)];
    const page: AdapterPage<EtsyReceipt> = {
      records,
      responseCount: 2,
      nextCursor: null,
      pageKey: "receipts:window:0",
      qpsLimit: 10,
      qpsRemaining: 9,
      qpdLimit: 10_000,
      qpdRemaining: 9_999,
    };
    const adapter = new ReceiptsAdapter();
    const env = {
      DB: db,
      ETSY_BUYER_HMAC_SECRET: "unit-test-hmac-key",
    } as unknown as Env;
    const context = { env, db, now: new Date("2026-07-25T12:00:00Z") };

    const first = await adapter.persistPage(context, task(), page);
    const second = await adapter.persistPage(context, task(), page);

    expect(first).toMatchObject({ source: 2, fetched: 4, inserted: 2, updated: 0 });
    expect(second).toMatchObject({ source: 2, fetched: 4, inserted: 0, updated: 2 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_receipts").get(),
    ).toEqual({ count: 2 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_transactions").get(),
    ).toEqual({ count: 2 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_receipt_refunds").get(),
    ).toEqual({ count: 1 });
    expect(
      db.preparedQueries.filter((query) =>
        query.includes("SELECT receipt_id FROM etsy_api_receipts"),
      ),
    ).toHaveLength(2);
    expect(
      db.preparedQueries.some((query) =>
        query.includes("SELECT receipt_id FROM etsy_api_receipts WHERE receipt_id = ?"),
      ),
    ).toBe(false);
    expect(
      db.preparedQueries.filter((query) =>
        query.includes("INSERT INTO etsy_api_receipts"),
      ),
    ).toHaveLength(2);
  });

  describe("period-scoped commerce sync", () => {
    const periodFromTs = 1_700_000_000;
    const periodToTs = 1_750_000_000; // exclusive upper bound
    const expectedSegmentEnd = periodToTs - 1;

    async function seedPeriodJob(db: FullSchemaTestD1, runId: string): Promise<void> {
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
      db.sqlite
        .prepare(
          `
            INSERT INTO etsy_api_shops (
              shop_id, user_id, shop_name, title, announcement, currency_code,
              synced_at
            ) VALUES ('shop','user','Shop','','','USD',CURRENT_TIMESTAMP)
          `,
        )
        .run();
      // Misleading sales cursor — period plan must ignore this.
      db.sqlite
        .prepare(
          `
            INSERT INTO etsy_sync_cursors (
              shop_id, resource, cursor_key, cursor_value, updated_at
            ) VALUES ('shop', 'sales', 'last_modified', '1799999999', CURRENT_TIMESTAMP)
          `,
        )
        .run();
      await createJob(db, {
        runId,
        shopId: "shop",
        requestedResource: "commerce",
        isPeriodRun: true,
        periodFromTs,
        periodToTs,
        resources: [{ resource: "receipts", adapterVersion: 1, ordinal: 0 }],
      });
    }

    it("planInitial uses job window bounds and ignores sales cursor", async () => {
      const db = new FullSchemaTestD1();
      const runId = "period-receipts";
      await seedPeriodJob(db, runId);
      const ctx = context(db);
      const adapter = new ReceiptsAdapter();

      const plans = await adapter.planInitial(ctx, runId, "shop");

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({
        resource: "receipts",
        segmentStart: periodFromTs,
        segmentEnd: expectedSegmentEnd,
        cursor: {
          filter: "created",
          mode: "manual_period",
          maxSeenTimestamp: 0,
        },
      });
      expect(plans[0]!.segmentEnd).toBe(periodToTs - 1);
      expect(
        db.preparedQueries.some((query) => query.includes("etsy_sync_cursors")),
      ).toBe(false);
    });

    it("planInitial inclusive end keeps toExclusiveTs-1 inside the segment", async () => {
      const db = new FullSchemaTestD1();
      const runId = "period-inclusive-end";
      await seedPeriodJob(db, runId);
      const ctx = context(db);
      const adapter = new ReceiptsAdapter();

      const [plan] = await adapter.planInitial(ctx, runId, "shop");

      // segmentEnd is inclusive; periodToTs is exclusive.
      // Receipt at periodToTs - 1 is inside; periodToTs itself is outside.
      expect(plan!.segmentEnd).toBe(periodToTs - 1);
      expect(plan!.segmentStart).toBeLessThanOrEqual(plan!.segmentEnd!);
      expect(plan!.segmentEnd! + 1).toBe(periodToTs);
    });

    it("planFinal returns no catchup tasks for period runs", async () => {
      const db = new FullSchemaTestD1();
      const runId = "period-no-catchup";
      await seedPeriodJob(db, runId);
      db.sqlite
        .prepare(
          `
            INSERT INTO etsy_sync_tasks (
              id, run_id, resource, adapter_version, strategy, idempotency_key,
              status, cursor_json, segment_start, segment_end, page_offset,
              page_size, attempt_count, max_attempts, created_at, updated_at
            ) VALUES (
              'backfill-task', ?, 'receipts', 1, 'time_windowed',
              'backfill-key', 'completed',
              '{"filter":"created","mode":"backfill"}',
              ?, ?, 0, 100, 1, 12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `,
        )
        .run(runId, periodFromTs, expectedSegmentEnd);
      const ctx = context(db);
      const adapter = new ReceiptsAdapter();

      const plans = await adapter.planFinal(ctx, runId, "shop");

      expect(plans).toEqual([]);
    });
  });
});

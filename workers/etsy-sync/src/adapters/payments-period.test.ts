import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../etsy", () => {
  class EtsyApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    EtsyApiError,
    etsyFetch: vi.fn(async () => ({
      body: { results: [], count: 0 },
      headers: new Headers(),
    })),
  };
});

import { PaymentsAdapter } from "./payments";
import { FullSchemaTestD1 } from "../test/testD1";
import type { SyncTask } from "../engine/types";
import type { Env } from "../types";

function baseTask(overrides: Partial<SyncTask> = {}): SyncTask {
  return {
    id: "task",
    runId: "run",
    shopId: "shop",
    resource: "payments",
    adapterVersion: 2,
    strategy: "parent_fanout",
    idempotencyKey: "run:payments",
    status: "running",
    cursor: {
      parentBatchSize: 5,
      afterCreateTimestamp: null,
      afterReceiptId: null,
      maxSeenTimestamp: 0,
    },
    segmentStart: null,
    segmentEnd: null,
    pageOffset: 0,
    pageSize: 5,
    expectedCount: null,
    attemptCount: 1,
    maxAttempts: 5,
    leaseToken: "lease",
    isPeriodRun: false,
    periodFromTs: null,
    periodToTs: null,
    ...overrides,
  };
}

function seedShop(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_shops (shop_id, user_id, shop_name, synced_at)
        VALUES ('shop', 'user', 'Test', '2026-01-01T00:00:00Z')
      `,
    )
    .run();
}

function seedReceipt(
  db: FullSchemaTestD1,
  receiptId: string,
  createTs: number,
  updateTs = createTs,
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, create_timestamp, update_timestamp,
          buyer_hash, status, synced_at
        ) VALUES (?, 'shop', ?, ?, 'buyer', 'paid', '2026-01-01T00:00:00Z')
      `,
    )
    .run(receiptId, createTs, updateTs);
}

function seedPayment(db: FullSchemaTestD1, paymentId: string, receiptId: string): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_payments (
          payment_id, receipt_id, shop_id, synced_at
        ) VALUES (?, ?, 'shop', '2026-01-01T00:00:00Z')
      `,
    )
    .run(paymentId, receiptId);
}

describe("payments period parent selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps parents inside the period window", async () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    const fromTs = Date.UTC(2026, 6, 1) / 1000;
    const toExclusiveTs = Date.UTC(2026, 7, 1) / 1000;
    seedReceipt(db, "in-window", fromTs + 10);
    seedReceipt(db, "before", fromTs - 10);
    seedReceipt(db, "at-end-exclusive", toExclusiveTs);

    const adapter = new PaymentsAdapter();
    const page = await adapter.fetchPage(
      { env: {} as Env, db, now: new Date("2026-08-01T00:00:00Z") },
      baseTask({
        isPeriodRun: true,
        periodFromTs: fromTs,
        periodToTs: toExclusiveTs,
      }),
    );
    expect(page.records.map((row) => row.receiptId)).toEqual(["in-window"]);
  });

  it("bypasses the delta predicate on period runs", async () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    const fromTs = Date.UTC(2026, 6, 1) / 1000;
    const toExclusiveTs = Date.UTC(2026, 7, 1) / 1000;
    seedReceipt(db, "already-paid", fromTs + 10, fromTs + 10);
    seedPayment(db, "pay-1", "already-paid");
    db.sqlite
      .prepare(
        `
          UPDATE etsy_api_payments
          SET synced_at='2099-01-01T00:00:00Z', update_timestamp=?
          WHERE payment_id='pay-1'
        `,
      )
      .run(fromTs + 20);

    const adapter = new PaymentsAdapter();
    const periodPage = await adapter.fetchPage(
      { env: {} as Env, db, now: new Date("2026-08-01T00:00:00Z") },
      baseTask({
        isPeriodRun: true,
        periodFromTs: fromTs,
        periodToTs: toExclusiveTs,
      }),
    );
    expect(periodPage.records.map((row) => row.receiptId)).toEqual(["already-paid"]);

    const incrementalPage = await adapter.fetchPage(
      { env: {} as Env, db, now: new Date("2026-08-01T00:00:00Z") },
      baseTask({ isPeriodRun: false }),
    );
    expect(incrementalPage.records).toEqual([]);
  });
});

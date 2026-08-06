import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import {
  completeResourceAndJobIfReady,
  createJob,
  createTasks,
} from "./repository";

describe("per-resource completion independence", () => {
  it("writes watermark for a healthy resource even when a sibling task failed", async () => {
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
      requestedResource: "finance",
      resources: [
        { resource: "receipts", adapterVersion: 1, ordinal: 0 },
        { resource: "payments", adapterVersion: 2, ordinal: 1 },
      ],
    });
    await createTasks(db, "run", [
      {
        resource: "receipts",
        adapterVersion: 1,
        strategy: "time_windowed",
        idempotencyKey: "run:receipts:done",
        cursor: { maxSeenTimestamp: 1_800_000_000, mode: "incremental" },
        segmentStart: 1,
        segmentEnd: 2,
      },
      {
        resource: "payments",
        adapterVersion: 2,
        strategy: "parent_fanout",
        idempotencyKey: "run:payments:fail",
        cursor: { maxSeenTimestamp: 0 },
      },
    ]);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP
          WHERE resource='receipts'
        `,
      )
      .run();
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='failed',
            last_error_code='boom', last_error_message='sibling failed'
          WHERE resource='payments'
        `,
      )
      .run();

    const completed = await completeResourceAndJobIfReady(
      db,
      "run",
      "receipts",
      "shop",
      1_800_000_000,
    );
    expect(completed).toBe(false);
    expect(
      db.sqlite
        .prepare(
          "SELECT status FROM etsy_sync_job_resources WHERE run_id='run' AND resource='receipts'",
        )
        .get(),
    ).toEqual({ status: "completed" });
    expect(
      db.sqlite
        .prepare(
          `
            SELECT cursor_value FROM etsy_sync_cursors
            WHERE shop_id='shop' AND resource='sales' AND cursor_key='last_modified'
          `,
        )
        .get(),
    ).toEqual({ cursor_value: "1800000000" });
  });
});

import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import {
  completeResourceAndJobIfReady,
  createJob,
  createTasks,
} from "./repository";

describe("completed generation compatibility", () => {
  it("marks reconciliation queued and exposes receipts to canonical legacy views", async () => {
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
      resources: [{ resource: "receipts", adapterVersion: 1, ordinal: 0 }],
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
    ]);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed',
            completed_at=CURRENT_TIMESTAMP
          WHERE run_id='run'
        `,
      )
      .run();
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_jobs
          SET status='partial',
              error_code='sync_heartbeat_expired',
              error_message='stale',
              next_resume_at='2026-07-26T00:00:00.000Z'
          WHERE id='run'
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
    expect(completed).toBe(true);
    expect(
      db.sqlite
        .prepare(
          `
            SELECT status, reconciliation_status, error_code,
              error_message, next_resume_at
            FROM etsy_sync_jobs WHERE id='run'
          `,
        )
        .get(),
    ).toEqual({
      status: "completed",
      reconciliation_status: "queued",
      error_code: null,
      error_message: null,
      next_resume_at: null,
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_sync_resources WHERE run_id='run'")
        .get<{ c: number }>()?.c,
    ).toBe(0);
    expect(
      db.sqlite
        .prepare(
          "SELECT status FROM etsy_reconciliation_generations WHERE run_id='run'",
        )
        .get(),
    ).toEqual({ status: "queued" });
  });
});

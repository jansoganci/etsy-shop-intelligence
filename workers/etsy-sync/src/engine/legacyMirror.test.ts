import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import {
  completeResourceAndJobIfReady,
  createJob,
  createTasks,
} from "./repository";

describe("Phase 9: legacy mirror writes removed", () => {
  it("completes a commerce job without writing etsy_sync_runs or etsy_sync_resources", async () => {
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
      requestedResource: "commerce",
      isPeriodRun: true,
      periodFromTs: 1,
      periodToTs: 2,
      resources: [
        { resource: "shop", adapterVersion: 1, ordinal: 0 },
        { resource: "receipts", adapterVersion: 1, ordinal: 1 },
        { resource: "payments", adapterVersion: 1, ordinal: 2 },
        { resource: "ledger_entries", adapterVersion: 1, ordinal: 3 },
      ],
    });
    for (const resource of ["shop", "receipts", "payments", "ledger_entries"]) {
      await createTasks(db, "run", [
        {
          resource,
          adapterVersion: 1,
          strategy: "singleton",
          idempotencyKey: `run:${resource}`,
          cursor: {},
          segmentStart: null,
          segmentEnd: null,
        },
      ]);
    }
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed', completed_at=CURRENT_TIMESTAMP
          WHERE run_id='run'
        `,
      )
      .run();
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='completed',
            completed_at=CURRENT_TIMESTAMP
          WHERE run_id='run' AND resource <> 'ledger_entries'
        `,
      )
      .run();

    expect(
      await completeResourceAndJobIfReady(db, "run", "ledger_entries", "shop", null),
    ).toBe(true);
    expect(
      db.sqlite
        .prepare("SELECT status FROM etsy_sync_jobs WHERE id='run'")
        .get<{ status: string }>()?.status,
    ).toBe("completed");
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_sync_runs WHERE id='run'")
        .get<{ c: number }>()?.c,
    ).toBe(0);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_sync_resources WHERE run_id='run'")
        .get<{ c: number }>()?.c,
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import {
  completeResourceAndJobIfReady,
  createJob,
  createTasks,
  upsertCommerceCoverage,
  writeCommerceCoverageForJob,
} from "./repository";

async function seedConnection(db: FullSchemaTestD1): Promise<void> {
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

describe("commerce coverage writer", () => {
  it("upserts coverage on completion and preserves first_synced_at", async () => {
    const db = new FullSchemaTestD1();
    await seedConnection(db);
    const fromTs = Date.UTC(2026, 6, 1) / 1000;
    const toExclusiveTs = Date.UTC(2026, 7, 1) / 1000;

    await upsertCommerceCoverage(db, {
      shopId: "shop",
      fromTs,
      toExclusiveTs,
      runId: "run-1",
      status: "complete",
      etsyReceiptCount: 1,
      persistedReceiptCount: 1,
      paymentParentsSelected: 1,
      paymentParentsChecked: 1,
      ledgerComplete: true,
      errorCode: null,
      errorMessage: null,
    });
    const first = db.sqlite
      .prepare(
        `
          SELECT first_synced_at, last_refreshed_at, last_run_id
          FROM etsy_commerce_period_coverage
          WHERE shop_id='shop' AND from_ts=? AND to_ts=?
        `,
      )
      .get<{
        first_synced_at: string;
        last_refreshed_at: string;
        last_run_id: string;
      }>(fromTs, toExclusiveTs);
    expect(first?.last_run_id).toBe("run-1");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await upsertCommerceCoverage(db, {
      shopId: "shop",
      fromTs,
      toExclusiveTs,
      runId: "run-2",
      status: "complete",
      etsyReceiptCount: 1,
      persistedReceiptCount: 1,
      paymentParentsSelected: 1,
      paymentParentsChecked: 1,
      ledgerComplete: true,
      errorCode: null,
      errorMessage: null,
    });
    const second = db.sqlite
      .prepare(
        `
          SELECT first_synced_at, last_refreshed_at, last_run_id
          FROM etsy_commerce_period_coverage
          WHERE shop_id='shop' AND from_ts=? AND to_ts=?
        `,
      )
      .get<{
        first_synced_at: string;
        last_refreshed_at: string;
        last_run_id: string;
      }>(fromTs, toExclusiveTs);
    expect(second?.last_run_id).toBe("run-2");
    expect(second?.first_synced_at).toBe(first?.first_synced_at);
    expect(second?.last_refreshed_at >= (first?.last_refreshed_at ?? "")).toBe(true);
  });

  it("marks partial when persisted receipts lag Etsy count", async () => {
    const db = new FullSchemaTestD1();
    await seedConnection(db);
    const fromTs = Date.UTC(2026, 6, 1) / 1000;
    const toExclusiveTs = Date.UTC(2026, 7, 1) / 1000;
    await createJob(db, {
      runId: "run",
      shopId: "shop",
      requestedResource: "commerce",
      isPeriodRun: true,
      periodFromTs: fromTs,
      periodToTs: toExclusiveTs,
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
    const receiptTaskId = db.sqlite
      .prepare(
        `
          SELECT id FROM etsy_sync_tasks
          WHERE run_id='run' AND resource='receipts' LIMIT 1
        `,
      )
      .get<{ id: string }>()?.id;
    expect(receiptTaskId).toBeTruthy();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_sync_page_commits (
            id, run_id, task_id, page_key,
            source_count, fetched_count, inserted_count, updated_count, unchanged_count,
            response_count
          ) VALUES ('c1','run',?,'p1',5,5,5,0,0,5)
        `,
      )
      .run(receiptTaskId);

    expect(
      await completeResourceAndJobIfReady(db, "run", "ledger_entries", "shop", null),
    ).toBe(true);
    expect(await writeCommerceCoverageForJob(db, "run")).toBe(true);

    const coverage = db.sqlite
      .prepare(
        `
          SELECT status, etsy_receipt_count, persisted_receipt_count, ledger_complete
          FROM etsy_commerce_period_coverage
          WHERE shop_id='shop' AND from_ts=? AND to_ts=?
        `,
      )
      .get<{
        status: string;
        etsy_receipt_count: number;
        persisted_receipt_count: number;
        ledger_complete: number;
      }>(fromTs, toExclusiveTs);
    expect(coverage).toMatchObject({
      status: "partial",
      etsy_receipt_count: 5,
      persisted_receipt_count: 0,
      ledger_complete: 1,
    });
  });
});

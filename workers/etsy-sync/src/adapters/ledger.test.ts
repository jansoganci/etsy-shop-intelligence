import { describe, expect, it } from "vitest";
import { ETSY_EPOCH_MIN } from "../engine/planner";
import { createJob } from "../engine/repository";
import { FullSchemaTestD1 } from "../test/testD1";
import type { Env } from "../types";
import { LEDGER_MAX_SPAN_SECONDS, LedgerEntriesAdapter } from "./ledger";

const SECONDS_PER_DAY = 86_400;
const NOW = new Date("2026-08-05T12:00:00Z");

function context(db: FullSchemaTestD1, now = NOW) {
  const env = { DB: db } as unknown as Env;
  return { db, env, now };
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

async function seedPeriodJob(
  db: FullSchemaTestD1,
  runId: string,
  periodFromTs: number,
  periodToTs: number,
): Promise<void> {
  await createJob(db, {
    runId,
    shopId: "shop",
    requestedResource: "commerce",
    periodFromTs,
    periodToTs,
    isPeriodRun: true,
    resources: [{ resource: "ledger_entries", adapterVersion: 2, ordinal: 0 }],
  });
}

async function seedIncrementalJob(db: FullSchemaTestD1, runId: string): Promise<void> {
  await createJob(db, {
    runId,
    shopId: "shop",
    requestedResource: "finance",
    resources: [{ resource: "ledger_entries", adapterVersion: 2, ordinal: 0 }],
  });
}

function segmentSpan(plan: { segmentStart: number | null; segmentEnd: number | null }): number {
  expect(plan.segmentStart).not.toBeNull();
  expect(plan.segmentEnd).not.toBeNull();
  return plan.segmentEnd! - plan.segmentStart!;
}

describe("LedgerEntriesAdapter planInitial chunking", () => {
  it("splits a 60-day period into at least two tasks within the max span", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const fromTs = 1_700_000_000;
    const toExclusiveTs = fromTs + 60 * SECONDS_PER_DAY;
    await seedPeriodJob(db, "run-60d", fromTs, toExclusiveTs);

    const plans = await new LedgerEntriesAdapter().planInitial(
      context(db),
      "run-60d",
      "shop",
    );

    expect(plans.length).toBeGreaterThanOrEqual(2);
    for (const plan of plans) {
      expect(segmentSpan(plan)).toBeLessThanOrEqual(LEDGER_MAX_SPAN_SECONDS);
      expect(plan.cursor).toMatchObject({ mode: "manual_period" });
    }
    expect(plans[0].segmentStart).toBe(fromTs);
    expect(plans.at(-1)!.segmentEnd).toBe(toExclusiveTs - 1);
  });

  it("plans exactly one task for calendar month July 2026", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const fromTs = Date.UTC(2026, 6, 1) / 1000;
    const toExclusiveTs = Date.UTC(2026, 7, 1) / 1000;
    await seedPeriodJob(db, "run-july", fromTs, toExclusiveTs);

    const plans = await new LedgerEntriesAdapter().planInitial(
      context(db),
      "run-july",
      "shop",
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      segmentStart: fromTs,
      segmentEnd: toExclusiveTs - 1,
      cursor: { mode: "manual_period", maxSeenTimestamp: 0 },
    });
  });

  it("cold plan chunks epoch to now instead of one giant segment", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    await seedIncrementalJob(db, "run-cold");

    const plans = await new LedgerEntriesAdapter().planInitial(
      context(db),
      "run-cold",
      "shop",
    );

    expect(plans.length).toBeGreaterThan(1);
    for (const plan of plans) {
      expect(segmentSpan(plan)).toBeLessThanOrEqual(LEDGER_MAX_SPAN_SECONDS);
    }
    expect(plans[0].segmentStart).toBe(ETSY_EPOCH_MIN);
    expect(plans.at(-1)!.segmentEnd).toBe(Math.floor(NOW.getTime() / 1000));

    const fullSpan = plans.at(-1)!.segmentEnd! - plans[0].segmentStart!;
    expect(fullSpan).toBeGreaterThan(LEDGER_MAX_SPAN_SECONDS);
    expect(plans).not.toEqual([
      expect.objectContaining({
        segmentStart: ETSY_EPOCH_MIN,
        segmentEnd: Math.floor(NOW.getTime() / 1000),
      }),
    ]);
  });

  it("keeps a short incremental window as a single task", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    await seedIncrementalJob(db, "run-inc");
    const nowSeconds = Math.floor(NOW.getTime() / 1000);
    const cursorValue = nowSeconds - 12 * 3600;
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_sync_cursors (
            shop_id, resource, cursor_key, cursor_value, updated_at
          ) VALUES ('shop', 'ledger_entries', 'last_modified', ?, CURRENT_TIMESTAMP)
        `,
      )
      .run(String(cursorValue));

    const plans = await new LedgerEntriesAdapter().planInitial(
      context(db),
      "run-inc",
      "shop",
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      segmentStart: cursorValue - 3600,
      segmentEnd: nowSeconds,
      cursor: { mode: "window", maxSeenTimestamp: cursorValue },
    });
    expect(segmentSpan(plans[0])).toBeLessThanOrEqual(LEDGER_MAX_SPAN_SECONDS);
  });
});

import { describe, expect, it } from "vitest";
import worker from "./index";
import { FullSchemaTestD1 } from "./test/testD1";
import type { Env } from "./types";
import {
  completeResourceAndJobIfReady,
  createJob,
  createTasks,
} from "./engine/repository";
import { resourcesFor } from "./engine/resources";

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

function syncRequest(body: unknown): Request {
  return new Request("https://etsy-sync.internal/internal/etsy/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-access-authenticated-user-email": "owner@example.com",
    },
    body: JSON.stringify(body),
  });
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

describe("commerce sync contract", () => {
  it("rejects commerce without period", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const response = await worker.fetch(syncRequest({ resource: "commerce" }), testEnv(db));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: "period_required" });
  });

  it("rejects legacy sales resource", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const response = await worker.fetch(syncRequest({ resource: "sales" }), testEnv(db));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_sync_resource",
    });
  });

  it("creates a commerce job with window columns", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const response = await worker.fetch(
      syncRequest({
        resource: "commerce",
        period: { from: "2026-07-01", to: "2026-07-31" },
      }),
      testEnv(db),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      ok: boolean;
      runId: string;
      resource: string;
      status: string;
      period: {
        fromTs: number;
        toExclusiveTs: number;
        fromDate: string;
        toDate: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.resource).toBe("commerce");
    expect(body.status).toBe("queued");
    expect(body.period).toEqual({
      fromTs: Date.UTC(2026, 6, 1) / 1000,
      toExclusiveTs: Date.UTC(2026, 7, 1) / 1000,
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
    });

    const job = db.sqlite
      .prepare(
        `
          SELECT requested_resource, is_period_run, period_from_ts, period_to_ts, status
          FROM etsy_sync_jobs WHERE id=?
        `,
      )
      .get<{
        requested_resource: string;
        is_period_run: number;
        period_from_ts: number;
        period_to_ts: number;
        status: string;
      }>(body.runId);
    expect(job).toEqual({
      requested_resource: "commerce",
      is_period_run: 1,
      period_from_ts: Date.UTC(2026, 6, 1) / 1000,
      period_to_ts: Date.UTC(2026, 7, 1) / 1000,
      status: "queued",
    });
  });

  it("rejects a second commerce job while one is active", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const first = await worker.fetch(
      syncRequest({
        resource: "commerce",
        period: { from: "2026-07-01", to: "2026-07-31" },
      }),
      testEnv(db),
    );
    expect(first.status).toBe(202);
    const second = await worker.fetch(
      syncRequest({
        resource: "commerce",
        period: { from: "2026-06-01", to: "2026-06-30" },
      }),
      testEnv(db),
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      ok: false,
      error: "sync_already_running",
    });
  });

  it("completes a commerce fixture job end-to-end without CHECK failure", async () => {
    const db = new FullSchemaTestD1();
    seedConnection(db);
    const resources = resourcesFor("commerce");
    await createJob(db, {
      runId: "commerce-e2e",
      shopId: "shop",
      requestedResource: "commerce",
      periodFromTs: Date.UTC(2026, 6, 1) / 1000,
      periodToTs: Date.UTC(2026, 7, 1) / 1000,
      isPeriodRun: true,
      resources: resources.map((resource, ordinal) => ({
        resource,
        adapterVersion: 1,
        ordinal,
      })),
    });
    for (const resource of resources) {
      await createTasks(db, "commerce-e2e", [
        {
          resource,
          adapterVersion: 1,
          strategy: "singleton",
          idempotencyKey: `commerce-e2e:${resource}:done`,
          cursor: {},
          segmentStart: null,
          segmentEnd: null,
        },
      ]);
    }
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed',
            completed_at=CURRENT_TIMESTAMP
          WHERE run_id='commerce-e2e'
        `,
      )
      .run();
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='completed',
            completed_at=CURRENT_TIMESTAMP
          WHERE run_id='commerce-e2e' AND resource <> 'ledger_entries'
        `,
      )
      .run();

    const completed = await completeResourceAndJobIfReady(
      db,
      "commerce-e2e",
      "ledger_entries",
      "shop",
      null,
    );
    expect(completed).toBe(true);
    expect(
      db.sqlite
        .prepare("SELECT status, requested_resource FROM etsy_sync_jobs WHERE id=?")
        .get("commerce-e2e"),
    ).toEqual({ status: "completed", requested_resource: "commerce" });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS c FROM etsy_sync_runs WHERE id=?")
        .get<{ c: number }>("commerce-e2e")?.c,
    ).toBe(0);
  });
});

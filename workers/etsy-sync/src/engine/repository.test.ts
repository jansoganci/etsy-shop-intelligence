import { readFileSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "../types";
import {
  claimTask,
  commitPage,
  createJob,
  createTasks,
  expireZombieJobs,
  loadPendingOutbox,
  recoverStaleTasks,
} from "./repository";
import type { AdapterPage, SyncTask } from "./types";

class TestStatement implements D1PreparedStatement {
  #values: unknown[] = [];

  constructor(readonly statement: StatementSync) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.#values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.statement.get(...this.#values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { results: this.statement.all(...this.#values) as T[] };
  }

  async run(): Promise<D1Result> {
    const result = this.statement.run(...this.#values);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE etsy_connections (shop_id TEXT PRIMARY KEY);
      CREATE TABLE etsy_sync_cursors (
        shop_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        cursor_key TEXT NOT NULL,
        cursor_value TEXT,
        last_success_at TEXT,
        initial_sync_completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (shop_id, resource, cursor_key)
      );
    `);
    for (const name of [
      "0015_create_generic_etsy_sync_engine.sql",
      "0021_job_control_and_budgets.sql",
      "0025_add_commerce_job_window.sql",
    ]) {
      const migration = readFileSync(
        new URL(`../../../../migrations/${name}`, import.meta.url),
        "utf8",
      );
      this.sqlite.exec(migration);
    }
    this.sqlite.prepare("INSERT INTO etsy_connections(shop_id) VALUES (?)").run("shop");
  }

  prepare(query: string): D1PreparedStatement {
    return new TestStatement(this.sqlite.prepare(query));
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

async function seededTask() {
  const db = new TestD1();
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
      idempotencyKey: "run:receipts:window",
      cursor: { filter: "created", mode: "backfill" },
      segmentStart: 100,
      segmentEnd: 200,
      pageOffset: 0,
      pageSize: 100,
    },
  ]);
  const row = db.sqlite
    .prepare("SELECT id FROM etsy_sync_tasks WHERE run_id='run'")
    .get() as { id: string };
  return { db, taskId: row.id };
}

function page(pageKey = "receipts:100:200:0"): AdapterPage {
  return {
    records: new Array(5).fill({}),
    responseCount: 10,
    nextCursor: { filter: "created", mode: "backfill", offset: 5 },
    pageKey,
    qpsLimit: 10,
    qpsRemaining: 9,
    qpdLimit: 10_000,
    qpdRemaining: 9_999,
  };
}

describe("durable Queue task repository", () => {
  it("normalizes D1 and ISO timestamps before expiring zombie jobs", async () => {
    const { db } = await seededTask();
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_jobs
          SET last_heartbeat_at='2026-07-25 21:21:42',
              updated_at='2026-07-25 21:21:42'
          WHERE id='run'
        `,
      )
      .run();

    expect(
      await expireZombieJobs(db, new Date("2026-07-25T21:27:42Z")),
    ).toBe(0);
    expect(
      db.sqlite
        .prepare("SELECT status, error_code FROM etsy_sync_jobs WHERE id='run'")
        .get(),
    ).toEqual({ status: "queued", error_code: null });

    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_jobs
          SET last_heartbeat_at='2026-07-25 20:00:00',
              updated_at='2026-07-25 20:00:00'
          WHERE id='run'
        `,
      )
      .run();

    expect(
      await expireZombieJobs(db, new Date("2026-07-25T21:27:42Z")),
    ).toBe(1);
    expect(
      db.sqlite
        .prepare("SELECT status, error_code FROM etsy_sync_jobs WHERE id='run'")
        .get(),
    ).toEqual({
      status: "partial",
      error_code: "sync_heartbeat_expired",
    });
  });

  it("safely acknowledges duplicate Queue delivery while a lease is active", async () => {
    const { db, taskId } = await seededTask();
    const now = new Date("2026-07-25T12:00:00Z");
    const first = await claimTask(db, taskId, "run", now);
    const duplicate = await claimTask(db, taskId, "run", now);
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
  });

  it("keeps a durable outbox continuation if the Worker dies before enqueue", async () => {
    const { db, taskId } = await seededTask();
    const task = (await claimTask(
      db,
      taskId,
      "run",
      new Date("2026-07-25T12:00:00Z"),
    )) as SyncTask;
    await commitPage(
      db,
      task,
      page(),
      { source: 5, fetched: 8, inserted: 5, updated: 0, unchanged: 0 },
      {
        done: false,
        nextCursor: page().nextCursor,
        nextOffset: 5,
      },
    );
    const pending = await loadPendingOutbox(
      db,
      // The SQLite CURRENT_TIMESTAMP used by commitPage follows the real test
      // clock. A far-future dispatcher clock keeps this assertion focused on
      // durable outbox creation instead of the date the suite happens to run.
      new Date("2100-01-01T00:00:00Z"),
    );
    expect(pending.some((row) => row.taskId === taskId)).toBe(true);
  });

  it("recovers an expired lease without browser involvement", async () => {
    const { db, taskId } = await seededTask();
    await claimTask(
      db,
      taskId,
      "run",
      new Date("2026-07-25T12:00:00Z"),
      30,
    );
    const recovered = await recoverStaleTasks(
      db,
      new Date("2026-07-25T12:01:00Z"),
    );
    const task = db.sqlite
      .prepare("SELECT status, lease_token FROM etsy_sync_tasks WHERE id=?")
      .get(taskId) as { status: string; lease_token: string | null };
    expect(recovered).toBe(1);
    expect(task).toEqual({ status: "queued", lease_token: null });
  });

  it("does not inflate counters when the same page is committed again", async () => {
    const { db, taskId } = await seededTask();
    const first = (await claimTask(
      db,
      taskId,
      "run",
      new Date("2026-07-25T12:00:00Z"),
    )) as SyncTask;
    const counts = { source: 5, fetched: 8, inserted: 5, updated: 0, unchanged: 0 };
    await commitPage(db, first, page(), counts, {
      done: false,
      nextCursor: page().nextCursor,
      nextOffset: 5,
    });
    const second = (await claimTask(
      db,
      taskId,
      "run",
      new Date("2026-07-25T12:03:00Z"),
    )) as SyncTask;
    await commitPage(db, second, page(), counts, {
      done: false,
      nextCursor: page().nextCursor,
      nextOffset: 5,
    });
    const job = db.sqlite
      .prepare(
        "SELECT fetched_count, inserted_count FROM etsy_sync_jobs WHERE id='run'",
      )
      .get() as { fetched_count: number; inserted_count: number };
    expect(job).toEqual({ fetched_count: 8, inserted_count: 5 });
  });
});

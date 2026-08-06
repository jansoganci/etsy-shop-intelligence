import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import type { Env } from "../types";
import { AdapterRegistry } from "./registry";
import { createJob, createTasks } from "./repository";
import { executeTaskMessage } from "./runtime";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  SyncTask,
  TaskPlan,
} from "./types";

class FailingAdapter implements EtsyResourceAdapter {
  readonly resource = "shop";
  readonly version = 1;
  readonly strategy = "singleton" as const;
  readonly dependencies = [] as const;
  readonly deletionPolicy = "none" as const;

  async planInitial(): Promise<TaskPlan[]> {
    return [];
  }

  async fetchPage(): Promise<AdapterPage> {
    throw new Error("temporary upstream failure");
  }

  async persistPage(
    _context: AdapterContext,
    _task: SyncTask,
    _page: AdapterPage,
  ) {
    return { source: 0, fetched: 0, inserted: 0, updated: 0, unchanged: 0 };
  }

  async planNext(): Promise<TaskPlan[]> {
    return [];
  }

  retryPolicy() {
    return { action: "retry" as const, delaySeconds: 5, code: "temporary" };
  }
}

describe("Queue runtime retry limits", () => {
  it("fails a normal retry after maxAttempts instead of looping forever", async () => {
    const db = new FullSchemaTestD1();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_connections (
            shop_id,etsy_user_id,scopes_json,access_token_ciphertext,
            access_token_iv,refresh_token_ciphertext,refresh_token_iv,
            access_token_expires_at,status
          ) VALUES ('shop','user','[]','a','i','r','i','2099-01-01','connected')
        `,
      )
      .run();
    await createJob(db, {
      runId: "run",
      shopId: "shop",
      requestedResource: "shop",
      resources: [{ resource: "shop", adapterVersion: 1, ordinal: 0 }],
    });
    await createTasks(db, "run", [{
      resource: "shop",
      adapterVersion: 1,
      strategy: "singleton",
      idempotencyKey: "run:shop",
      pageSize: 1,
    }]);
    db.sqlite
      .prepare(
        `
          UPDATE etsy_sync_tasks SET attempt_count=11, max_attempts=12
          WHERE run_id='run'
        `,
      )
      .run();
    const task = db.sqlite
      .prepare("SELECT id FROM etsy_sync_tasks WHERE run_id='run'")
      .get() as { id: string };
    const env = {
      DB: db,
      ETSY_SYNC_QUEUE: { send: async () => undefined },
    } as unknown as Env;

    expect(
      await executeTaskMessage(
        env,
        new AdapterRegistry().register(new FailingAdapter()),
        { taskId: task.id, runId: "run" },
        new Date("2026-07-26T00:00:00Z"),
      ),
    ).toEqual({ action: "ack" });
    expect(
      db.sqlite
        .prepare("SELECT status,last_error_code FROM etsy_sync_tasks WHERE id=?")
        .get(task.id),
    ).toEqual({
      status: "failed",
      last_error_code: "temporary_attempts_exhausted",
    });
    expect(
      db.sqlite.prepare("SELECT status FROM etsy_sync_jobs WHERE id='run'").get(),
    ).toEqual({ status: "partial" });
  });
});

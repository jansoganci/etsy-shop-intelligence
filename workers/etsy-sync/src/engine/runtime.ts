import {
  ETSY_OFFSET_MAX,
  needsWindowSplit,
  splitTaskPlan,
} from "./planner";
import { preflightDelaySeconds } from "./rateLimit";
import {
  claimTask,
  commitPage,
  completeResourceAndJobIfReady,
  completeSplitTask,
  createTasks,
  deferTask,
  failTask,
  heartbeatTask,
  incrementSoftBudget,
  loadJobWindow,
  loadPendingOutbox,
  loadRateLimitState,
  markOutboxSent,
  markPaginationExhausted,
  pauseJob,
  recoverStaleTasks,
  saveRateLimitState,
  softBudgetBlocks,
  writeCommerceCoverageForJob,
} from "./repository";
import type { AdapterRegistry } from "./registry";
import type { Env } from "../types";
import type { QueueTaskMessage, SyncTask } from "./types";

export type TaskExecutionResult =
  | { action: "ack" }
  | { action: "retry"; delaySeconds: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown sync task failure.";
}

async function finishTask(
  env: Env,
  registry: AdapterRegistry,
  task: SyncTask,
  now: Date,
): Promise<void> {
  await finalizeReadyJobs(env, registry, now, task.runId);
}

export async function planReadyResources(
  env: Env,
  registry: AdapterRegistry,
  runId: string,
  now = new Date(),
): Promise<number> {
  const rows = await env.DB
    .prepare(
      `
        SELECT resource, status FROM etsy_sync_job_resources
        WHERE run_id=? ORDER BY ordinal
      `,
    )
    .bind(runId)
    .all<{ resource: string; status: string }>();
  const statuses = new Map(
    (rows.results ?? []).map((row) => [row.resource, row.status]),
  );
  let planned = 0;
  for (const [resource, status] of statuses) {
    if (status !== "pending") continue;
    const adapter = registry.get(resource);
    const blocked = adapter.dependencies.some(
      (dependency) =>
        statuses.has(dependency) &&
        !["completed", "skipped"].includes(statuses.get(dependency) ?? ""),
    );
    if (blocked) continue;
    const job = await env.DB
      .prepare("SELECT shop_id FROM etsy_sync_jobs WHERE id=?")
      .bind(runId)
      .first<{ shop_id: string }>();
    if (!job) throw new Error(`sync_job_missing:${runId}`);
    const plans = await adapter.planInitial(
      { env, db: env.DB, now },
      runId,
      job.shop_id,
    );
    if (plans.length > 0) {
      await createTasks(env.DB, runId, plans);
      await env.DB
        .prepare(
          `
            UPDATE etsy_sync_job_resources SET status='queued',
              updated_at=CURRENT_TIMESTAMP
            WHERE run_id=? AND resource=? AND status='pending'
          `,
        )
        .bind(runId, resource)
        .run();
      statuses.set(resource, "queued");
    } else {
      await env.DB
        .prepare(
          `
            UPDATE etsy_sync_job_resources SET status='completed',
              started_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
            WHERE run_id=? AND resource=? AND status='pending'
          `,
        )
        .bind(runId, resource)
        .run();
      statuses.set(resource, "completed");
    }
    planned += 1;
  }
  if (planned > 0) {
    await env.DB
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status='queued',
            last_heartbeat_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('queued','running')
        `,
      )
      .bind(runId)
      .run();
  }
  return planned;
}

export async function finalizeReadyJobs(
  env: Env,
  registry: AdapterRegistry,
  now = new Date(),
  onlyRunId?: string,
): Promise<number> {
  const rows = await env.DB
    .prepare(
      `
        SELECT job.id AS run_id, job.shop_id, resource.resource
        FROM etsy_sync_jobs job
        JOIN etsy_sync_job_resources resource ON resource.run_id=job.id
        WHERE job.status IN ('queued','running','retry_wait','rate_limited')
          AND resource.status IN ('queued','running','retry_wait','rate_limited')
          AND (? IS NULL OR job.id=?)
          AND NOT EXISTS (
            SELECT 1 FROM etsy_sync_tasks task
            WHERE task.run_id=job.id AND task.resource=resource.resource
              AND task.status NOT IN ('completed','cancelled')
          )
      `,
    )
    .bind(onlyRunId ?? null, onlyRunId ?? null)
    .all<{ run_id: string; shop_id: string; resource: string }>();
  let finalized = 0;
  for (const row of rows.results ?? []) {
    const adapter = registry.get(row.resource);
    const finalPlans = adapter.planFinal
      ? await adapter.planFinal(
          { env, db: env.DB, now },
          row.run_id,
          row.shop_id,
        )
      : [];
    if (finalPlans.length > 0) {
      await createTasks(env.DB, row.run_id, finalPlans);
      continue;
    }
    if (adapter.finalize) {
      await adapter.finalize(
        { env, db: env.DB, now },
        row.run_id,
        row.shop_id,
      );
    }
    // Period runs must never advance etsy_sync_cursors. Passing null relies on
    // completeResourceAndJobIfReady's existing `if (maxSeenTimestamp && …)` guard.
    const jobWindow = await loadJobWindow(env.DB, row.run_id);
    let maxSeenTimestamp: number | null = null;
    if (!jobWindow?.isPeriodRun) {
      const maxSeen = await env.DB
        .prepare(
          `
            SELECT MAX(CAST(json_extract(cursor_json, '$.maxSeenTimestamp') AS INTEGER)) AS value
            FROM etsy_sync_tasks WHERE run_id=? AND resource=?
          `,
        )
        .bind(row.run_id, row.resource)
        .first<{ value: number | null }>();
      maxSeenTimestamp = maxSeen?.value ?? null;
    }
    if (
      await completeResourceAndJobIfReady(
        env.DB,
        row.run_id,
        row.resource,
        row.shop_id,
        maxSeenTimestamp,
      )
    ) {
      finalized += 1;
      await writeCommerceCoverageForJob(env.DB, row.run_id);
    }
    await planReadyResources(env, registry, row.run_id, now);
  }
  return finalized;
}

export async function executeTaskMessage(
  env: Env,
  registry: AdapterRegistry,
  message: QueueTaskMessage,
  now = new Date(),
): Promise<TaskExecutionResult> {
  const task = await claimTask(env.DB, message.taskId, message.runId, now, 15 * 60);
  // Duplicate Queue delivery, an already-completed task, or an unexpired lease
  // is acknowledged without touching progress counters.
  if (!task) return { action: "ack" };

  const budget = await softBudgetBlocks(env.DB, now);
  if (budget.blocked) {
    const resumeAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    await pauseJob(env.DB, task.runId, budget.reason ?? "daily_budget", resumeAt);
    await deferTask(
      env.DB,
      task,
      "rate_limited",
      24 * 60 * 60,
      budget.reason ?? "daily_budget",
      "Soft daily budget reached. Resume manually or wait for the next day.",
      now,
    );
    return { action: "ack" };
  }

  const limiter = await loadRateLimitState(env.DB);
  const preflightDelay = preflightDelaySeconds(limiter, now);
  if (preflightDelay > 0) {
    const softHit =
      limiter.qpdRemaining != null &&
      limiter.qpdRemaining <= Math.max(1, limiter.softQpdReserve ?? 300);
    if (softHit) {
      const resumeAt = new Date(now.getTime() + preflightDelay * 1000).toISOString();
      await pauseJob(env.DB, task.runId, "daily_budget", resumeAt);
    }
    await deferTask(
      env.DB,
      task,
      "rate_limited",
      preflightDelay,
      softHit ? "daily_budget" : "etsy_rate_limit_preflight",
      softHit
        ? "Soft Etsy QPD reserve reached. Continue tomorrow or resume when remaining quota recovers."
        : "Etsy rate-limit checkpoint requires an automatic pause.",
      now,
    );
    return { action: "retry", delaySeconds: preflightDelay };
  }

  const adapter = registry.get(task.resource);
  try {
    await heartbeatTask(env.DB, task, now, 15 * 60);
    const page = await adapter.fetchPage({ env, db: env.DB, now }, task);
    await heartbeatTask(env.DB, task, new Date(), 15 * 60);
    await saveRateLimitState(env.DB, page);

    if (needsWindowSplit(page.responseCount) && task.strategy === "time_windowed") {
      if (
        task.segmentStart == null ||
        task.segmentEnd == null ||
        task.segmentEnd <= task.segmentStart
      ) {
        await markPaginationExhausted(
          env.DB,
          task,
          "More than 12,000 Etsy records share the smallest splittable timestamp window.",
        );
        return { action: "ack" };
      }
      const children = splitTaskPlan({
        runId: task.runId,
        resource: task.resource,
        adapterVersion: task.adapterVersion,
        segmentStart: task.segmentStart,
        segmentEnd: task.segmentEnd,
        pageSize: task.pageSize,
        cursor: task.cursor,
      });
      await completeSplitTask(env.DB, task, children);
      return { action: "ack" };
    }
    if (needsWindowSplit(page.responseCount)) {
      await markPaginationExhausted(
        env.DB,
        task,
        `${task.resource} cannot safely page beyond Etsy's 12,000-record offset limit.`,
      );
      return { action: "ack" };
    }

    const nextOffset = page.nextCursor
      ? Number(page.nextCursor.offset ?? task.pageOffset + page.records.length)
      : task.pageOffset + page.records.length;
    if (
      page.nextCursor &&
      page.nextCursor.complete !== true &&
      nextOffset >= ETSY_OFFSET_MAX &&
      page.responseCount == null
    ) {
      await markPaginationExhausted(
        env.DB,
        task,
        "Etsy did not provide a splittable count before the 12,000 offset ceiling.",
      );
      return { action: "ack" };
    }

    const counts = await adapter.persistPage({ env, db: env.DB, now }, task, page);
    await heartbeatTask(env.DB, task, new Date(), 15 * 60);
    const done =
      page.nextCursor == null || page.nextCursor.complete === true;
    // Strip the ephemeral `complete` flag before persisting cursor_json so
    // finalize can still read maxSeenTimestamp from the completed task.
    const persistedCursor =
      page.nextCursor == null
        ? null
        : Object.fromEntries(
            Object.entries(page.nextCursor).filter(([key]) => key !== "complete"),
          );
    await commitPage(env.DB, task, page, counts, {
      done,
      nextCursor: persistedCursor,
      nextOffset,
      nextDispatchKey: `task:${task.id}:after:${page.pageKey}`,
    });
    if (done) await finishTask(env, registry, task, now);
    return { action: "ack" };
  } catch (error) {
    const decision = adapter.retryPolicy(error, task.attemptCount);
    if (
      decision.action === "retry" &&
      task.attemptCount >= task.maxAttempts
    ) {
      await failTask(
        env.DB,
        task,
        `${decision.code}_attempts_exhausted`,
        `Retry limit (${task.maxAttempts}) reached. ${errorMessage(error)}`,
      );
      return { action: "ack" };
    }
    if (
      decision.action === "retry" ||
      decision.action === "rate_limit"
    ) {
      const status =
        decision.action === "rate_limit" ? "rate_limited" : "retry_wait";
      const blockedUntil =
        decision.action === "rate_limit"
          ? new Date(now.getTime() + decision.delaySeconds * 1000).toISOString()
          : null;
      if (blockedUntil) {
        await saveRateLimitState(
          env.DB,
          {
            qpsLimit: null,
            qpsRemaining: 0,
            qpdLimit: null,
            qpdRemaining: null,
          },
          blockedUntil,
        );
      }
      await deferTask(
        env.DB,
        task,
        status,
        decision.delaySeconds,
        decision.code,
        errorMessage(error),
        now,
      );
      return { action: "retry", delaySeconds: decision.delaySeconds };
    }
    await failTask(env.DB, task, decision.code, errorMessage(error));
    return { action: "ack" };
  }
}

export async function dispatchOutbox(
  env: Env,
  now = new Date(),
  limit = 100,
): Promise<number> {
  const budget = await softBudgetBlocks(env.DB, now);
  if (budget.blocked) return 0;
  const rows = await loadPendingOutbox(env.DB, now, limit);
  const sent: string[] = [];
  for (const row of rows) {
    await env.ETSY_SYNC_QUEUE.send({ taskId: row.taskId, runId: row.runId });
    sent.push(row.id);
  }
  if (sent.length > 0) {
    await incrementSoftBudget(env.DB, now, { queueOps: sent.length });
  }
  await markOutboxSent(env.DB, sent);
  return sent.length;
}

export async function recoverAndDispatch(
  env: Env,
  registry: AdapterRegistry,
  now = new Date(),
): Promise<{ recovered: number; finalized: number; dispatched: number }> {
  const recovered = await recoverStaleTasks(env.DB, now);
  const finalized = await finalizeReadyJobs(env, registry, now);
  const dispatched = await dispatchOutbox(env, now);
  return { recovered, finalized, dispatched };
}

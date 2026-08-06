import type { D1Database, D1PreparedStatement } from "../types";
import type {
  AdapterPage,
  JobWindow,
  PersistCounts,
  QueueTaskMessage,
  SyncTask,
  SyncTaskStatus,
  TaskPlan,
} from "./types";

type TaskRow = {
  id: string;
  run_id: string;
  shop_id: string;
  resource: string;
  adapter_version: number;
  strategy: SyncTask["strategy"];
  idempotency_key: string;
  status: SyncTaskStatus;
  cursor_json: string;
  segment_start: number | null;
  segment_end: number | null;
  page_offset: number;
  page_size: number;
  expected_count: number | null;
  attempt_count: number;
  max_attempts: number;
  lease_token: string | null;
  is_period_run: number | null;
  period_from_ts: number | null;
  period_to_ts: number | null;
};

function mapTask(row: TaskRow): SyncTask {
  let cursor: Record<string, unknown> = {};
  try {
    cursor = JSON.parse(row.cursor_json || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(`sync_task_cursor_invalid:${row.id}`);
  }
  return {
    id: row.id,
    runId: row.run_id,
    shopId: row.shop_id,
    resource: row.resource,
    adapterVersion: row.adapter_version,
    strategy: row.strategy,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    cursor,
    segmentStart: row.segment_start,
    segmentEnd: row.segment_end,
    pageOffset: row.page_offset,
    pageSize: row.page_size,
    expectedCount: row.expected_count,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
    isPeriodRun: Number(row.is_period_run ?? 0) === 1,
    periodFromTs:
      typeof row.period_from_ts === "number" && Number.isFinite(row.period_from_ts)
        ? row.period_from_ts
        : null,
    periodToTs:
      typeof row.period_to_ts === "number" && Number.isFinite(row.period_to_ts)
        ? row.period_to_ts
        : null,
  };
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function createTasks(
  db: D1Database,
  runId: string,
  plans: TaskPlan[],
): Promise<QueueTaskMessage[]> {
  if (plans.length === 0) return [];
  const rows = plans.map((plan) => ({
    taskId: newId(),
    outboxId: newId(),
    runId,
    resource: plan.resource,
    adapterVersion: plan.adapterVersion,
    strategy: plan.strategy,
    idempotencyKey: plan.idempotencyKey,
    parentTaskId: plan.parentTaskId ?? null,
    dependencyKey: plan.dependencyKey ?? null,
    cursor: plan.cursor ?? {},
    segmentStart: plan.segmentStart ?? null,
    segmentEnd: plan.segmentEnd ?? null,
    pageOffset: plan.pageOffset ?? 0,
    pageSize: plan.pageSize ?? 100,
    dispatchKey: `task:${plan.idempotencyKey}:initial`,
  }));
  const payload = JSON.stringify(rows);
  // JSON bulk insertion keeps even large future fan-outs within D1's
  // per-invocation query budget. Conflicting deterministic keys reuse the
  // canonical task ID when the outbox row is selected.
  await db.batch([
    db
      .prepare(
        `
          INSERT INTO etsy_sync_tasks (
            id, run_id, resource, adapter_version, strategy,
            idempotency_key, parent_task_id, dependency_key, status,
            cursor_json, segment_start, segment_end, page_offset, page_size
          )
          SELECT
            json_extract(value,'$.taskId'), json_extract(value,'$.runId'),
            json_extract(value,'$.resource'), json_extract(value,'$.adapterVersion'),
            json_extract(value,'$.strategy'), json_extract(value,'$.idempotencyKey'),
            json_extract(value,'$.parentTaskId'), json_extract(value,'$.dependencyKey'),
            'queued', json(json_extract(value,'$.cursor')),
            json_extract(value,'$.segmentStart'), json_extract(value,'$.segmentEnd'),
            json_extract(value,'$.pageOffset'), json_extract(value,'$.pageSize')
          FROM json_each(?) WHERE 1
          ON CONFLICT(idempotency_key) DO NOTHING
        `,
      )
      .bind(payload),
    db
      .prepare(
        `
          INSERT INTO etsy_sync_outbox (
            id, dispatch_key, run_id, task_id, status
          )
          SELECT
            json_extract(item.value,'$.outboxId'),
            json_extract(item.value,'$.dispatchKey'),
            json_extract(item.value,'$.runId'), task.id, 'pending'
          FROM json_each(?) item
          JOIN etsy_sync_tasks task
            ON task.idempotency_key=json_extract(item.value,'$.idempotencyKey')
          WHERE 1
          ON CONFLICT(dispatch_key) DO NOTHING
        `,
      )
      .bind(payload),
    db
      .prepare(
      `
        UPDATE etsy_sync_jobs SET
          total_tasks=(SELECT COUNT(*) FROM etsy_sync_tasks WHERE run_id=?),
          updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `,
    )
      .bind(runId, runId),
  ]);
  // The outbox dispatcher reloads canonical task IDs. The optimistic messages
  // are useful only to callers that inserted without a conflict.
  return rows.map((row) => ({ taskId: row.taskId, runId }));
}

export async function createJob(
  db: D1Database,
  input: {
    runId: string;
    shopId: string;
    requestedResource: string;
    resources: Array<{ resource: string; adapterVersion: number; ordinal: number }>;
    periodFromTs?: number | null;
    periodToTs?: number | null;
    isPeriodRun?: boolean;
  },
): Promise<void> {
  const isPeriodRun = input.isPeriodRun === true ? 1 : 0;
  await db.batch([
    db
      .prepare(
        `
          INSERT INTO etsy_sync_jobs (
            id, shop_id, requested_resource, status, control_state, last_heartbeat_at,
            period_from_ts, period_to_ts, is_period_run
          ) VALUES (?, ?, ?, 'queued', 'running', CURRENT_TIMESTAMP, ?, ?, ?)
        `,
      )
      .bind(
        input.runId,
        input.shopId,
        input.requestedResource,
        input.periodFromTs ?? null,
        input.periodToTs ?? null,
        isPeriodRun,
      ),
    ...input.resources.map((resource) =>
      db
        .prepare(
          `
            INSERT INTO etsy_sync_job_resources (
              run_id, resource, adapter_version, ordinal, status
            ) VALUES (?, ?, ?, ?, 'pending')
          `,
        )
        .bind(
          input.runId,
          resource.resource,
          resource.adapterVersion,
          resource.ordinal,
        ),
    ),
  ]);
}

export async function claimTask(
  db: D1Database,
  taskId: string,
  runId: string,
  now: Date,
  leaseSeconds = 120,
): Promise<SyncTask | null> {
  const leaseToken = newId();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const claimed = await db
    .prepare(
      `
        UPDATE etsy_sync_tasks SET
          status='running', lease_token=?, lease_expires_at=?,
          heartbeat_at=?, attempt_count=attempt_count + 1,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND run_id=?
          AND status IN ('pending','queued','retry_wait','rate_limited','running')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          AND (
            status <> 'running' OR lease_expires_at IS NULL OR lease_expires_at <= ?
          )
          AND EXISTS (
            SELECT 1 FROM etsy_sync_jobs job
            WHERE job.id = etsy_sync_tasks.run_id
              AND COALESCE(job.control_state, 'running') = 'running'
          )
      `,
    )
    .bind(
      leaseToken,
      leaseExpiresAt,
      now.toISOString(),
      taskId,
      runId,
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  if (!claimed.meta?.changes) return null;
  const row = await db
    .prepare(
      `
        SELECT
          task.id, task.run_id, job.shop_id, task.resource, task.adapter_version,
          task.strategy, task.idempotency_key, task.status, task.cursor_json,
          task.segment_start, task.segment_end, task.page_offset, task.page_size,
          task.expected_count, task.attempt_count, task.max_attempts, task.lease_token,
          COALESCE(job.is_period_run, 0) AS is_period_run,
          job.period_from_ts, job.period_to_ts
        FROM etsy_sync_tasks task
        JOIN etsy_sync_jobs job ON job.id=task.run_id
        WHERE task.id=? AND task.run_id=? AND task.lease_token=?
      `,
    )
    .bind(taskId, runId, leaseToken)
    .first<TaskRow>();
  return row ? mapTask(row) : null;
}

export async function loadJobWindow(
  db: D1Database,
  runId: string,
): Promise<JobWindow | null> {
  const row = await db
    .prepare(
      `
        SELECT
          id AS run_id,
          shop_id,
          COALESCE(is_period_run, 0) AS is_period_run,
          period_from_ts,
          period_to_ts
        FROM etsy_sync_jobs
        WHERE id=?
      `,
    )
    .bind(runId)
    .first<{
      run_id: string;
      shop_id: string;
      is_period_run: number;
      period_from_ts: number | null;
      period_to_ts: number | null;
    }>();
  if (!row) return null;
  return {
    runId: row.run_id,
    shopId: row.shop_id,
    isPeriodRun: Number(row.is_period_run) === 1,
    periodFromTs:
      typeof row.period_from_ts === "number" && Number.isFinite(row.period_from_ts)
        ? row.period_from_ts
        : null,
    periodToTs:
      typeof row.period_to_ts === "number" && Number.isFinite(row.period_to_ts)
        ? row.period_to_ts
        : null,
  };
}

export async function heartbeatTask(
  db: D1Database,
  task: SyncTask,
  now: Date,
  leaseSeconds = 120,
): Promise<boolean> {
  if (!task.leaseToken) return false;
  const result = await db
    .prepare(
      `
        UPDATE etsy_sync_tasks SET heartbeat_at=?, lease_expires_at=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND lease_token=? AND status='running'
      `,
    )
    .bind(
      now.toISOString(),
      new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
      task.id,
      task.leaseToken,
    )
    .run();
  return Boolean(result.meta?.changes);
}

export async function commitPage(
  db: D1Database,
  task: SyncTask,
  page: AdapterPage,
  counts: PersistCounts,
  options: {
    done: boolean;
    nextCursor: Record<string, unknown> | null;
    nextOffset: number;
    nextDispatchKey?: string;
  },
): Promise<void> {
  if (!task.leaseToken) throw new Error("sync_task_lease_missing");
  const previous = await db
    .prepare(
      `
        SELECT counters_applied_at FROM etsy_sync_page_commits
        WHERE task_id=? AND page_key=?
      `,
    )
    .bind(task.id, page.pageKey)
    .first<{ counters_applied_at: string | null }>();
  if (previous?.counters_applied_at) {
    // A Queue message may be delivered again after its page transaction
    // committed. Release only this duplicate lease; never increment counters
    // or move the durable cursor backwards.
    await db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET
            status=CASE WHEN completed_at IS NULL THEN 'queued' ELSE 'completed' END,
            lease_token=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_token=?
        `,
      )
      .bind(task.id, task.leaseToken)
      .run();
    return;
  }
  const commitId = newId();
  const outboxId = newId();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `
          INSERT INTO etsy_sync_page_commits (
            id, run_id, task_id, page_key, source_count, fetched_count,
            inserted_count, updated_count, unchanged_count, response_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(task_id, page_key) DO NOTHING
        `,
      )
      .bind(
        commitId,
        task.runId,
        task.id,
        page.pageKey,
        counts.source,
        counts.fetched,
        counts.inserted,
        counts.updated,
        counts.unchanged,
        page.responseCount,
      ),
    db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET
            status=?, cursor_json=?, page_offset=?,
            expected_count=COALESCE(?, expected_count),
            fetched_count=fetched_count + ?,
            inserted_count=inserted_count + ?,
            updated_count=updated_count + ?,
            unchanged_count=unchanged_count + ?,
            lease_token=NULL, lease_expires_at=NULL,
            next_attempt_at=NULL,
            last_error_code=NULL, last_error_message=NULL,
            completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_token=? AND EXISTS (
            SELECT 1 FROM etsy_sync_page_commits pc
            WHERE pc.task_id=? AND pc.page_key=? AND pc.counters_applied_at IS NULL
          )
        `,
      )
      .bind(
        options.done ? "completed" : "queued",
        JSON.stringify(options.nextCursor ?? {}),
        options.nextOffset,
        page.responseCount,
        counts.fetched,
        counts.inserted,
        counts.updated,
        counts.unchanged,
        options.done ? 1 : 0,
        task.id,
        task.leaseToken,
        task.id,
        page.pageKey,
      ),
    db
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET
            status='running',
            fetched_count=fetched_count + ?,
            inserted_count=inserted_count + ?,
            updated_count=updated_count + ?,
            unchanged_count=unchanged_count + ?,
            error_code=NULL, error_message=NULL,
            started_at=COALESCE(started_at, CURRENT_TIMESTAMP),
            updated_at=CURRENT_TIMESTAMP
          WHERE run_id=? AND resource=? AND EXISTS (
            SELECT 1 FROM etsy_sync_page_commits pc
            WHERE pc.task_id=? AND pc.page_key=? AND pc.counters_applied_at IS NULL
          )
        `,
      )
      .bind(
        counts.fetched,
        counts.inserted,
        counts.updated,
        counts.unchanged,
        task.runId,
        task.resource,
        task.id,
        page.pageKey,
      ),
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET
            status='running', current_resource=?,
            fetched_count=fetched_count + ?,
            inserted_count=inserted_count + ?,
            updated_count=updated_count + ?,
            unchanged_count=unchanged_count + ?,
            rate_limit_qpd_remaining=COALESCE(?, rate_limit_qpd_remaining),
            rate_limit_qps_remaining=COALESCE(?, rate_limit_qps_remaining),
            next_resume_at=NULL, error_code=NULL, error_message=NULL,
            last_heartbeat_at=CURRENT_TIMESTAMP,
            started_at=COALESCE(started_at, CURRENT_TIMESTAMP),
            updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND EXISTS (
            SELECT 1 FROM etsy_sync_page_commits pc
            WHERE pc.task_id=? AND pc.page_key=? AND pc.counters_applied_at IS NULL
          )
        `,
      )
      .bind(
        task.resource,
        counts.fetched,
        counts.inserted,
        counts.updated,
        counts.unchanged,
        page.qpdRemaining,
        page.qpsRemaining,
        task.runId,
        task.id,
        page.pageKey,
      ),
  ];
  if (!options.done) {
    const dispatchKey =
      options.nextDispatchKey ?? `task:${task.id}:offset:${options.nextOffset}`;
    statements.push(
      db
        .prepare(
          `
            INSERT INTO etsy_sync_outbox (
              id, dispatch_key, run_id, task_id, status
            )
            SELECT ?, ?, ?, ?, 'pending'
            WHERE EXISTS (
              SELECT 1 FROM etsy_sync_page_commits pc
              WHERE pc.task_id=? AND pc.page_key=? AND pc.counters_applied_at IS NULL
            )
            ON CONFLICT(dispatch_key) DO NOTHING
          `,
        )
        .bind(
          outboxId,
          dispatchKey,
          task.runId,
          task.id,
          task.id,
          page.pageKey,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `
          UPDATE etsy_sync_page_commits SET counters_applied_at=CURRENT_TIMESTAMP
          WHERE task_id=? AND page_key=? AND counters_applied_at IS NULL
        `,
      )
      .bind(task.id, page.pageKey),
  );
  await db.batch(statements);
  await incrementSoftBudget(db, new Date(), { d1WriteOps: 1 });
}

export async function completeSplitTask(
  db: D1Database,
  task: SyncTask,
  childPlans: TaskPlan[],
): Promise<void> {
  if (!task.leaseToken) throw new Error("sync_task_lease_missing");
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='completed', lease_token=NULL,
            lease_expires_at=NULL, completed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_token=?
        `,
      )
      .bind(task.id, task.leaseToken),
  ];
  for (const plan of childPlans) {
    const childId = newId();
    statements.push(
      db
        .prepare(
          `
            INSERT INTO etsy_sync_tasks (
              id, run_id, resource, adapter_version, strategy,
              idempotency_key, parent_task_id, dependency_key, status,
              cursor_json, segment_start, segment_end, page_offset, page_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
            ON CONFLICT(idempotency_key) DO NOTHING
          `,
        )
        .bind(
          childId,
          task.runId,
          plan.resource,
          plan.adapterVersion,
          plan.strategy,
          plan.idempotencyKey,
          task.id,
          plan.dependencyKey ?? null,
          JSON.stringify(plan.cursor ?? {}),
          plan.segmentStart ?? null,
          plan.segmentEnd ?? null,
          plan.pageOffset ?? 0,
          plan.pageSize ?? 100,
        ),
      db
        .prepare(
          `
            INSERT INTO etsy_sync_outbox (
              id, dispatch_key, run_id, task_id, status
            )
            SELECT ?, ?, ?, id, 'pending'
            FROM etsy_sync_tasks WHERE idempotency_key=?
            ON CONFLICT(dispatch_key) DO NOTHING
          `,
        )
        .bind(
          newId(),
          `task:${plan.idempotencyKey}:initial`,
          task.runId,
          plan.idempotencyKey,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET
            total_tasks=(SELECT COUNT(*) FROM etsy_sync_tasks WHERE run_id=?),
            updated_at=CURRENT_TIMESTAMP WHERE id=?
        `,
      )
      .bind(task.runId, task.runId),
  );
  await db.batch(statements);
}

export async function markPaginationExhausted(
  db: D1Database,
  task: SyncTask,
  message: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='source_pagination_exhausted',
            lease_token=NULL, lease_expires_at=NULL,
            last_error_code='source_pagination_exhausted',
            last_error_message=?, completed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_token=?
        `,
      )
      .bind(message, task.id, task.leaseToken),
    db
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='source_pagination_exhausted',
            error_code='source_pagination_exhausted', error_message=?,
            completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE run_id=? AND resource=?
        `,
      )
      .bind(message, task.runId, task.resource),
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status='source_pagination_exhausted',
            error_code='source_pagination_exhausted', error_message=?,
            completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(message, task.runId),
  ]);
}

export async function countOpenResourceTasks(
  db: D1Database,
  runId: string,
  resource: string,
): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_sync_tasks
        WHERE run_id=? AND resource=?
          AND status NOT IN ('completed','cancelled','source_pagination_exhausted')
      `,
    )
    .bind(runId, resource)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function completeResourceAndJobIfReady(
  db: D1Database,
  runId: string,
  resource: string,
  shopId: string,
  maxSeenTimestamp: number | null,
): Promise<boolean> {
  const open = await countOpenResourceTasks(db, runId, resource);
  if (open > 0) return false;
  // Only same-resource failures block watermark write — sibling failures must
  // not prevent a healthy resource from completing and advancing its cursor.
  const failed = await db
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_sync_tasks
        WHERE run_id=? AND resource=?
          AND status IN ('failed','source_pagination_exhausted')
      `,
    )
    .bind(runId, resource)
    .first<{ count: number }>();
  if (Number(failed?.count ?? 0) > 0) return false;
  const otherOpen = await db
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_sync_tasks
        WHERE run_id=? AND resource=? AND status NOT IN ('completed','cancelled')
      `,
    )
    .bind(runId, resource)
    .first<{ count: number }>();
  if (Number(otherOpen?.count ?? 0) > 0) return false;
  await db
    .prepare(
      `
        UPDATE etsy_sync_job_resources SET status='completed',
          completed_at=CURRENT_TIMESTAMP, error_code=NULL, error_message=NULL,
          updated_at=CURRENT_TIMESTAMP
        WHERE run_id=? AND resource=?
      `,
    )
    .bind(runId, resource)
    .run();

  if (maxSeenTimestamp && maxSeenTimestamp > 0) {
    const cursorResource = resource === "receipts" ? "sales" : resource;
    await db
      .prepare(
        `
          INSERT INTO etsy_sync_cursors (
            shop_id, resource, cursor_key, cursor_value,
            last_success_at, initial_sync_completed_at
          ) VALUES (?, ?, 'last_modified', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(shop_id, resource, cursor_key) DO UPDATE SET
            cursor_value=excluded.cursor_value,
            last_success_at=CURRENT_TIMESTAMP,
            initial_sync_completed_at=COALESCE(
              etsy_sync_cursors.initial_sync_completed_at,
              CURRENT_TIMESTAMP
            ),
            updated_at=CURRENT_TIMESTAMP
        `,
      )
      .bind(shopId, cursorResource, String(maxSeenTimestamp))
      .run();
  }

  const remainingResources = await db
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_sync_job_resources
        WHERE run_id=? AND status NOT IN ('completed','skipped')
      `,
    )
    .bind(runId)
    .first<{ count: number }>();
  if (Number(remainingResources?.count ?? 0) > 0) {
    await db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status='running', current_resource=NULL,
            completed_tasks=(
              SELECT COUNT(*) FROM etsy_sync_tasks
              WHERE run_id=? AND status='completed'
            ),
            last_heartbeat_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(runId, runId)
      .run();
    return false;
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status='completed', current_resource=NULL,
            completed_tasks=(SELECT COUNT(*) FROM etsy_sync_tasks WHERE run_id=? AND status='completed'),
            completed_at=CURRENT_TIMESTAMP, last_heartbeat_at=CURRENT_TIMESTAMP,
            next_resume_at=NULL, error_code=NULL, error_message=NULL,
            reconciliation_status='queued', updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(runId, runId),
    db
      .prepare(
        `
          INSERT INTO etsy_reconciliation_generations (
            id, run_id, shop_id, status
          ) VALUES (?, ?, ?, 'queued')
          ON CONFLICT(run_id) DO NOTHING
        `,
      )
      .bind(newId(), runId, shopId),
  ];
  await db.batch(statements);
  return true;
}

export type CommerceCoverageStatus = "running" | "complete" | "partial" | "failed";

export async function upsertCommerceCoverage(
  db: D1Database,
  input: {
    shopId: string;
    fromTs: number;
    toExclusiveTs: number;
    runId: string;
    status: CommerceCoverageStatus;
    etsyReceiptCount: number | null;
    persistedReceiptCount: number;
    paymentParentsSelected: number;
    paymentParentsChecked: number;
    ledgerComplete: boolean;
    errorCode: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO etsy_commerce_period_coverage (
          shop_id, from_ts, to_ts, last_run_id, status,
          etsy_receipt_count, persisted_receipt_count,
          payment_parents_selected, payment_parents_checked,
          ledger_complete, first_synced_at, last_refreshed_at,
          error_code, error_message, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
          ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT(shop_id, from_ts, to_ts) DO UPDATE SET
          last_run_id=excluded.last_run_id,
          status=excluded.status,
          etsy_receipt_count=excluded.etsy_receipt_count,
          persisted_receipt_count=excluded.persisted_receipt_count,
          payment_parents_selected=excluded.payment_parents_selected,
          payment_parents_checked=excluded.payment_parents_checked,
          ledger_complete=excluded.ledger_complete,
          first_synced_at=COALESCE(
            etsy_commerce_period_coverage.first_synced_at,
            CURRENT_TIMESTAMP
          ),
          last_refreshed_at=CURRENT_TIMESTAMP,
          error_code=excluded.error_code,
          error_message=excluded.error_message,
          updated_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      input.shopId,
      input.fromTs,
      input.toExclusiveTs,
      input.runId,
      input.status,
      input.etsyReceiptCount,
      input.persistedReceiptCount,
      input.paymentParentsSelected,
      input.paymentParentsChecked,
      input.ledgerComplete ? 1 : 0,
      input.errorCode,
      input.errorMessage,
    )
    .run();
}

export async function writeCommerceCoverageForJob(
  db: D1Database,
  runId: string,
): Promise<boolean> {
  const job = await db
    .prepare(
      `
        SELECT shop_id, status, error_code, error_message,
          COALESCE(is_period_run, 0) AS is_period_run,
          period_from_ts, period_to_ts
        FROM etsy_sync_jobs WHERE id=?
      `,
    )
    .bind(runId)
    .first<{
      shop_id: string;
      status: string;
      error_code: string | null;
      error_message: string | null;
      is_period_run: number;
      period_from_ts: number | null;
      period_to_ts: number | null;
    }>();
  if (!job || Number(job.is_period_run) !== 1) return false;
  if (
    typeof job.period_from_ts !== "number" ||
    typeof job.period_to_ts !== "number"
  ) {
    return false;
  }
  if (!["completed", "failed", "partial"].includes(job.status)) return false;

  const fromTs = job.period_from_ts;
  const toExclusiveTs = job.period_to_ts;

  const etsyCountRow = await db
    .prepare(
      `
        SELECT MAX(pc.response_count) AS value
        FROM etsy_sync_page_commits pc
        JOIN etsy_sync_tasks t ON t.id = pc.task_id
        WHERE pc.run_id=? AND t.resource='receipts'
      `,
    )
    .bind(runId)
    .first<{ value: number | null }>();
  const etsyReceiptCount =
    typeof etsyCountRow?.value === "number" && Number.isFinite(etsyCountRow.value)
      ? etsyCountRow.value
      : null;

  const persistedRow = await db
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_api_receipts
        WHERE shop_id=? AND create_timestamp >= ? AND create_timestamp < ?
      `,
    )
    .bind(job.shop_id, fromTs, toExclusiveTs)
    .first<{ count: number }>();
  const persistedReceiptCount = Number(persistedRow?.count ?? 0);
  const paymentParentsSelected = persistedReceiptCount;

  const checkedRow = await db
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_api_receipts r
        WHERE r.shop_id=?
          AND r.create_timestamp >= ?
          AND r.create_timestamp < ?
          AND (
            EXISTS (
              SELECT 1 FROM etsy_api_payments p WHERE p.receipt_id = r.receipt_id
            )
            OR EXISTS (
              SELECT 1 FROM etsy_api_payment_probes probe
              WHERE probe.receipt_id = r.receipt_id
            )
          )
      `,
    )
    .bind(job.shop_id, fromTs, toExclusiveTs)
    .first<{ count: number }>();
  const paymentParentsChecked = Number(checkedRow?.count ?? 0);

  const ledgerRow = await db
    .prepare(
      `
        SELECT status FROM etsy_sync_job_resources
        WHERE run_id=? AND resource='ledger_entries'
      `,
    )
    .bind(runId)
    .first<{ status: string }>();
  const ledgerComplete = ledgerRow?.status === "completed";

  const resourcesDone = await db
    .prepare(
      `
        SELECT
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
          COUNT(*) AS total
        FROM etsy_sync_job_resources WHERE run_id=?
      `,
    )
    .bind(runId)
    .first<{ completed: number; total: number }>();
  const allResourcesCompleted =
    Number(resourcesDone?.total ?? 0) > 0 &&
    Number(resourcesDone?.completed ?? 0) === Number(resourcesDone?.total ?? 0);

  let status: CommerceCoverageStatus;
  if (job.status === "failed") {
    status = "failed";
  } else if (
    allResourcesCompleted &&
    (etsyReceiptCount == null || persistedReceiptCount >= etsyReceiptCount) &&
    paymentParentsChecked >= paymentParentsSelected &&
    ledgerComplete
  ) {
    status = "complete";
  } else {
    status = "partial";
  }

  await upsertCommerceCoverage(db, {
    shopId: job.shop_id,
    fromTs,
    toExclusiveTs,
    runId,
    status,
    etsyReceiptCount,
    persistedReceiptCount,
    paymentParentsSelected,
    paymentParentsChecked,
    ledgerComplete,
    errorCode: job.error_code,
    errorMessage: job.error_message,
  });
  return true;
}

export async function loadRateLimitState(
  db: D1Database,
): Promise<{
  qpsRemaining: number | null;
  qpdRemaining: number | null;
  blockedUntil: string | null;
  lastResponseAt: string | null;
  softQpdReserve: number | null;
}> {
  const row = await db
    .prepare(
      `
        SELECT qps_remaining, qpd_remaining, blocked_until, last_response_at,
          soft_qpd_reserve
        FROM etsy_api_rate_limit_state WHERE limiter_key='etsy_app'
      `,
    )
    .first<{
      qps_remaining: number | null;
      qpd_remaining: number | null;
      blocked_until: string | null;
      last_response_at: string | null;
      soft_qpd_reserve: number | null;
    }>();
  return {
    qpsRemaining: row?.qps_remaining ?? null,
    qpdRemaining: row?.qpd_remaining ?? null,
    blockedUntil: row?.blocked_until ?? null,
    lastResponseAt: row?.last_response_at ?? null,
    softQpdReserve: row?.soft_qpd_reserve ?? null,
  };
}

export async function saveRateLimitState(
  db: D1Database,
  rate: {
    qpsLimit: number | null;
    qpsRemaining: number | null;
    qpdLimit: number | null;
    qpdRemaining: number | null;
  },
  blockedUntil: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO etsy_api_rate_limit_state (
          limiter_key, qps_limit, qps_remaining, qpd_limit, qpd_remaining,
          blocked_until, last_response_at
        ) VALUES ('etsy_app', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(limiter_key) DO UPDATE SET
          qps_limit=COALESCE(excluded.qps_limit, qps_limit),
          qps_remaining=COALESCE(excluded.qps_remaining, qps_remaining),
          qpd_limit=COALESCE(excluded.qpd_limit, qpd_limit),
          qpd_remaining=COALESCE(excluded.qpd_remaining, qpd_remaining),
          blocked_until=excluded.blocked_until,
          last_response_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      rate.qpsLimit,
      rate.qpsRemaining,
      rate.qpdLimit,
      rate.qpdRemaining,
      blockedUntil,
    )
    .run();
}

export async function deferTask(
  db: D1Database,
  task: SyncTask,
  status: "retry_wait" | "rate_limited",
  delaySeconds: number,
  code: string,
  message: string,
  now: Date,
): Promise<void> {
  const availableAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  await db.batch([
    db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status=?, next_attempt_at=?,
            lease_token=NULL, lease_expires_at=NULL,
            last_error_code=?, last_error_message=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_token=?
        `,
      )
      .bind(status, availableAt, code, message, task.id, task.leaseToken),
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status=?, next_resume_at=?,
            error_code=?, error_message=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(status, availableAt, code, message, task.runId),
  ]);
}

export async function failTask(
  db: D1Database,
  task: SyncTask,
  code: string,
  message: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='failed', lease_token=NULL,
            lease_expires_at=NULL, last_error_code=?, last_error_message=?,
            completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND lease_token=?
        `,
      )
      .bind(code, message, task.id, task.leaseToken),
    db
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='failed',
            error_count=error_count + 1, error_code=?, error_message=?,
            updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND resource=?
        `,
      )
      .bind(code, message, task.runId, task.resource),
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status='partial', failed_tasks=failed_tasks + 1,
            error_code=?, error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
        `,
      )
      .bind(code, message, task.runId),
  ]);
}

export async function expireZombieJobs(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const result = await db
    .prepare(
      `
        UPDATE etsy_sync_jobs SET status='partial',
          error_code='sync_heartbeat_expired',
          error_message='No live task heartbeat was observed within 15 minutes.',
          completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE status IN ('queued','running','retry_wait','rate_limited')
          AND COALESCE(control_state, 'running') = 'running'
          AND datetime(COALESCE(last_heartbeat_at, updated_at)) < datetime(?)
          AND (
            next_resume_at IS NULL
            OR datetime(next_resume_at) <= datetime(?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM etsy_sync_tasks task
            WHERE task.run_id=etsy_sync_jobs.id
              AND task.status='running'
              AND datetime(task.lease_expires_at) > datetime(?)
          )
      `,
    )
    .bind(cutoff, now.toISOString(), now.toISOString())
    .run();
  return Number(result.meta?.changes ?? 0);
}

export const SOFT_QUEUE_OPS_DAY = 2_500;
export const SOFT_D1_WRITE_OPS_DAY = 80_000;

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function loadSoftBudgetDay(
  db: D1Database,
  now = new Date(),
): Promise<{ dayKey: string; queueOps: number; d1WriteOps: number }> {
  const dayKey = utcDayKey(now);
  const row = await db
    .prepare(
      `
        SELECT queue_ops, d1_write_ops FROM etsy_sync_soft_budget_day
        WHERE day_key=?
      `,
    )
    .bind(dayKey)
    .first<{ queue_ops: number; d1_write_ops: number }>();
  return {
    dayKey,
    queueOps: Number(row?.queue_ops ?? 0),
    d1WriteOps: Number(row?.d1_write_ops ?? 0),
  };
}

export async function incrementSoftBudget(
  db: D1Database,
  now: Date,
  delta: { queueOps?: number; d1WriteOps?: number },
): Promise<void> {
  const dayKey = utcDayKey(now);
  await db
    .prepare(
      `
        INSERT INTO etsy_sync_soft_budget_day (
          day_key, queue_ops, d1_write_ops, updated_at
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(day_key) DO UPDATE SET
          queue_ops=queue_ops + excluded.queue_ops,
          d1_write_ops=d1_write_ops + excluded.d1_write_ops,
          updated_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(dayKey, delta.queueOps ?? 0, delta.d1WriteOps ?? 0)
    .run();
}

export async function softBudgetBlocks(
  db: D1Database,
  now = new Date(),
): Promise<{ blocked: boolean; reason: string | null }> {
  const day = await loadSoftBudgetDay(db, now);
  if (day.queueOps >= SOFT_QUEUE_OPS_DAY) {
    return { blocked: true, reason: "daily_budget_queue" };
  }
  if (day.d1WriteOps >= SOFT_D1_WRITE_OPS_DAY) {
    return { blocked: true, reason: "daily_budget_d1" };
  }
  return { blocked: false, reason: null };
}

export async function pauseJob(
  db: D1Database,
  runId: string,
  reason: string,
  nextResumeAt: string | null = null,
): Promise<boolean> {
  const result = await db
    .prepare(
      `
        UPDATE etsy_sync_jobs SET
          control_state='paused',
          pause_reason=?,
          next_resume_at=?,
          error_code=?,
          error_message=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=?
          AND status IN ('queued','running','retry_wait','rate_limited','partial')
          AND COALESCE(control_state, 'running') IN ('running', 'paused')
      `,
    )
    .bind(
      reason,
      nextResumeAt,
      reason,
      reason === "user_paused"
        ? "Sync paused by user."
        : "Sync paused by soft daily budget.",
      runId,
    )
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function resumeJob(db: D1Database, runId: string, now = new Date()): Promise<boolean> {
  const result = await db
    .prepare(
      `
        UPDATE etsy_sync_jobs SET
          control_state='running',
          pause_reason=NULL,
          next_resume_at=NULL,
          error_code=CASE
            WHEN pause_reason IN ('user_paused','daily_budget','daily_budget_queue','daily_budget_d1')
              OR error_code IN ('user_paused','daily_budget','daily_budget_queue','daily_budget_d1','etsy_rate_limit_preflight')
            THEN NULL ELSE error_code
          END,
          error_message=CASE
            WHEN pause_reason IN ('user_paused','daily_budget','daily_budget_queue','daily_budget_d1')
              OR error_code IN ('user_paused','daily_budget','daily_budget_queue','daily_budget_d1','etsy_rate_limit_preflight')
            THEN NULL ELSE error_message
          END,
          status=CASE WHEN status IN ('rate_limited','retry_wait') THEN 'running' ELSE status END,
          last_heartbeat_at=?,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=?
          AND COALESCE(control_state, 'running') = 'paused'
      `,
    )
    .bind(now.toISOString(), runId)
    .run();
  if (Number(result.meta?.changes ?? 0) <= 0) return false;
  const open = await db
    .prepare(
      `
        SELECT id FROM etsy_sync_tasks
        WHERE run_id=? AND status IN ('pending','queued','retry_wait','rate_limited')
      `,
    )
    .bind(runId)
    .all<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  for (const task of open.results ?? []) {
    statements.push(
      db
        .prepare(
          `
            UPDATE etsy_sync_tasks SET status='queued', next_attempt_at=NULL,
              updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `,
        )
        .bind(task.id),
      db
        .prepare(
          `
            INSERT INTO etsy_sync_outbox (
              id, dispatch_key, run_id, task_id, status
            ) VALUES (?, ?, ?, ?, 'pending')
            ON CONFLICT(dispatch_key) DO NOTHING
          `,
        )
        .bind(newId(), `resume:${runId}:${task.id}`, runId, task.id),
    );
  }
  if (statements.length) await db.batch(statements);
  return true;
}

export async function cancelJob(db: D1Database, runId: string): Promise<boolean> {
  const job = await db
    .prepare(
      `
        SELECT id, status, COALESCE(control_state, 'running') AS control_state
        FROM etsy_sync_jobs WHERE id=?
      `,
    )
    .bind(runId)
    .first<{ id: string; status: string; control_state: string }>();
  if (!job) return false;
  if (
    ["completed", "cancelled", "failed"].includes(job.status) &&
    job.control_state === "cancelled"
  ) {
    return false;
  }
  await db.batch([
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET
            control_state='cancelling',
            pause_reason='user_cancelled',
            error_code='user_cancelled',
            error_message='Sync cancelled by user. Stored data and cursors were kept.',
            updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(runId),
    db
      .prepare(
        `
          UPDATE etsy_sync_tasks SET
            status='cancelled', lease_token=NULL, lease_expires_at=NULL,
            next_attempt_at=NULL, completed_at=CURRENT_TIMESTAMP,
            last_error_code='user_cancelled',
            last_error_message='Task cancelled with the parent sync job.',
            updated_at=CURRENT_TIMESTAMP
          WHERE run_id=? AND status NOT IN ('completed','cancelled')
        `,
      )
      .bind(runId),
    db
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET
            status=CASE WHEN status IN ('completed','skipped') THEN status ELSE 'skipped' END,
            error_code=CASE WHEN status IN ('completed','skipped') THEN error_code ELSE 'user_cancelled' END,
            error_message=CASE WHEN status IN ('completed','skipped') THEN error_message ELSE 'Cancelled with parent job.' END,
            updated_at=CURRENT_TIMESTAMP
          WHERE run_id=?
        `,
      )
      .bind(runId),
    db
      .prepare(
        `
          UPDATE etsy_sync_jobs SET
            control_state='cancelled',
            status='cancelled',
            completed_at=CURRENT_TIMESTAMP,
            next_resume_at=NULL,
            updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(runId),
  ]);
  return true;
}

export async function killAllActiveJobs(
  db: D1Database,
  shopId?: string | null,
): Promise<number> {
  const rows = await db
    .prepare(
      `
        SELECT id FROM etsy_sync_jobs
        WHERE (
          status IN ('queued','running','retry_wait','rate_limited','partial')
          OR COALESCE(control_state, 'running') IN ('running','paused','cancelling')
        )
        AND status NOT IN ('completed','cancelled','failed')
        AND (? IS NULL OR shop_id=?)
      `,
    )
    .bind(shopId ?? null, shopId ?? null)
    .all<{ id: string }>();
  let cancelled = 0;
  for (const row of rows.results ?? []) {
    if (await cancelJob(db, row.id)) cancelled += 1;
  }
  return cancelled;
}

export async function recoverStaleTasks(
  db: D1Database,
  now: Date,
  limit = 100,
): Promise<number> {
  const rows = await db
    .prepare(
      `
        SELECT id, run_id FROM etsy_sync_tasks
        WHERE (
          status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
        ) OR (
          status IN ('retry_wait','rate_limited')
          AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
        ) OR (
          status='queued'
          AND lease_token IS NULL
          AND updated_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM etsy_sync_outbox o
            WHERE o.task_id = etsy_sync_tasks.id AND o.status = 'pending'
          )
        )
        ORDER BY updated_at LIMIT ?
      `,
    )
    .bind(
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      limit,
    )
    .all<{ id: string; run_id: string }>();
  const tasks = rows.results ?? [];
  if (tasks.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  for (const task of tasks) {
    statements.push(
      db
        .prepare(
          `
            UPDATE etsy_sync_tasks SET status='queued', lease_token=NULL,
              lease_expires_at=NULL, next_attempt_at=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `,
        )
        .bind(task.id),
      db
        .prepare(
          `
            INSERT INTO etsy_sync_outbox (
              id, dispatch_key, run_id, task_id, status
            ) VALUES (?, ?, ?, ?, 'pending')
            ON CONFLICT(dispatch_key) DO NOTHING
          `,
        )
        .bind(
          newId(),
          `recovery:${task.id}:${now.toISOString()}`,
          task.run_id,
          task.id,
        ),
    );
  }
  await db.batch(statements);
  return tasks.length;
}

export async function loadPendingOutbox(
  db: D1Database,
  now: Date,
  limit = 100,
): Promise<Array<{ id: string; taskId: string; runId: string }>> {
  const rows = await db
    .prepare(
      `
        SELECT id, task_id, run_id FROM etsy_sync_outbox
        WHERE status='pending' AND available_at <= ?
        ORDER BY created_at LIMIT ?
      `,
    )
    .bind(now.toISOString(), limit)
    .all<{ id: string; task_id: string; run_id: string }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
  }));
}

export async function markOutboxSent(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id) =>
      db
        .prepare(
          `
            UPDATE etsy_sync_outbox SET status='sent', sent_at=CURRENT_TIMESTAMP
            WHERE id=? AND status='pending'
          `,
        )
        .bind(id),
    ),
  );
}

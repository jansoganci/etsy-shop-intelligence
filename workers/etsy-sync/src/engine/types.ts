import type { D1Database, Env } from "../types";

export type SyncStrategy =
  | "singleton"
  | "offset_paged"
  | "time_windowed"
  | "parent_fanout"
  | "batch_by_id"
  | "local_derived";

export type SyncTaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "retry_wait"
  | "rate_limited"
  | "completed"
  | "failed"
  | "cancelled"
  | "source_pagination_exhausted";

export type QueueTaskMessage = {
  taskId: string;
  runId: string;
};

export type SyncTask = {
  id: string;
  runId: string;
  shopId: string;
  resource: string;
  adapterVersion: number;
  strategy: SyncStrategy;
  idempotencyKey: string;
  status: SyncTaskStatus;
  cursor: Record<string, unknown>;
  segmentStart: number | null;
  segmentEnd: number | null;
  pageOffset: number;
  pageSize: number;
  expectedCount: number | null;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string | null;
  /** Sourced from etsy_sync_jobs.is_period_run (Phase 1 watermark isolation). */
  isPeriodRun: boolean;
  /** Inclusive UTC epoch seconds; null for incremental jobs. */
  periodFromTs: number | null;
  /** Exclusive UTC epoch seconds; null for incremental jobs. */
  periodToTs: number | null;
};

export type JobWindow = {
  runId: string;
  shopId: string;
  isPeriodRun: boolean;
  periodFromTs: number | null;
  periodToTs: number | null;
};

export type TaskPlan = {
  resource: string;
  adapterVersion: number;
  strategy: SyncStrategy;
  idempotencyKey: string;
  parentTaskId?: string;
  dependencyKey?: string;
  cursor?: Record<string, unknown>;
  segmentStart?: number;
  segmentEnd?: number;
  pageOffset?: number;
  pageSize?: number;
};

export type PersistCounts = {
  source: number;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
};

export type AdapterPage<T = unknown> = {
  records: T[];
  responseCount: number | null;
  nextCursor: Record<string, unknown> | null;
  pageKey: string;
  qpsLimit: number | null;
  qpsRemaining: number | null;
  qpdLimit: number | null;
  qpdRemaining: number | null;
};

export type RetryDecision =
  | { action: "retry"; delaySeconds: number; code: string }
  | { action: "rate_limit"; delaySeconds: number; code: string }
  | { action: "fail"; code: string }
  | { action: "reauthorize"; code: string };

export type AdapterContext = {
  env: Env;
  db: D1Database;
  now: Date;
};

export interface EtsyResourceAdapter<T = unknown> {
  readonly resource: string;
  readonly version: number;
  readonly strategy: SyncStrategy;
  readonly dependencies: readonly string[];
  readonly deletionPolicy: "none" | "full_snapshot" | "parent_snapshot";

  planInitial(context: AdapterContext, runId: string, shopId: string): Promise<TaskPlan[]>;
  fetchPage(context: AdapterContext, task: SyncTask): Promise<AdapterPage<T>>;
  persistPage(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<T>,
  ): Promise<PersistCounts>;
  planNext(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<T>,
  ): Promise<TaskPlan[]>;
  planFinal?(
    context: AdapterContext,
    runId: string,
    shopId: string,
  ): Promise<TaskPlan[]>;
  finalize?(
    context: AdapterContext,
    runId: string,
    shopId: string,
  ): Promise<void>;
  retryPolicy(error: unknown, attempt: number): RetryDecision;
}

export type EngineRepository = {
  db: D1Database;
};

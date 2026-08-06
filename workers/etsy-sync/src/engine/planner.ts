import type { TaskPlan } from "./types";

export const ETSY_PAGE_SIZE_MAX = 100;
export const ETSY_OFFSET_MAX = 12_000;
export const ETSY_EPOCH_MIN = 946_684_800;

export type TimeWindow = {
  start: number;
  end: number;
};

export function normalizePageSize(value: number): number {
  if (!Number.isFinite(value)) return ETSY_PAGE_SIZE_MAX;
  return Math.max(1, Math.min(ETSY_PAGE_SIZE_MAX, Math.floor(value)));
}

export function splitTimeWindow(window: TimeWindow): [TimeWindow, TimeWindow] {
  if (window.end <= window.start) {
    throw new Error("time_window_cannot_be_split");
  }
  const midpoint = window.start + Math.floor((window.end - window.start) / 2);
  return [
    { start: window.start, end: midpoint },
    { start: midpoint + 1, end: window.end },
  ];
}

export function needsWindowSplit(
  responseCount: number | null,
  offsetLimit = ETSY_OFFSET_MAX,
): boolean {
  return responseCount != null && responseCount > offsetLimit;
}

export function pageKeyForTask(task: {
  resource: string;
  segmentStart: number | null;
  segmentEnd: number | null;
  pageOffset: number;
}): string {
  return [
    task.resource,
    task.segmentStart ?? "none",
    task.segmentEnd ?? "none",
    task.pageOffset,
  ].join(":");
}

export function deterministicTaskKey(
  runId: string,
  resource: string,
  strategy: string,
  segmentStart: number | null,
  segmentEnd: number | null,
  offset: number,
  suffix = "",
): string {
  return [
    runId,
    resource,
    strategy,
    segmentStart ?? "none",
    segmentEnd ?? "none",
    offset,
    suffix,
  ].join(":");
}

export function splitTaskPlan(task: {
  runId: string;
  resource: string;
  adapterVersion: number;
  segmentStart: number | null;
  segmentEnd: number | null;
  pageSize: number;
  cursor?: Record<string, unknown>;
}): TaskPlan[] {
  if (task.segmentStart == null || task.segmentEnd == null) {
    throw new Error("time_window_missing");
  }
  const [left, right] = splitTimeWindow({
    start: task.segmentStart,
    end: task.segmentEnd,
  });
  return [left, right].map((window) => ({
    resource: task.resource,
    adapterVersion: task.adapterVersion,
    strategy: "time_windowed" as const,
    idempotencyKey: deterministicTaskKey(
      task.runId,
      task.resource,
      "time_windowed",
      window.start,
      window.end,
      0,
    ),
    cursor: { ...(task.cursor ?? {}) },
    segmentStart: window.start,
    segmentEnd: window.end,
    pageOffset: 0,
    pageSize: normalizePageSize(task.pageSize),
  }));
}

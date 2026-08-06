import { EtsyApiError } from "../etsy";
import type { RetryDecision } from "./types";

const MAX_RETRY_DELAY_SECONDS = 6 * 60 * 60;

export type EtsyRateHeaders = {
  qpsLimit: number | null;
  qpsRemaining: number | null;
  qpdLimit: number | null;
  qpdRemaining: number | null;
};

function numericHeader(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw == null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function readEtsyRateHeaders(headers: Headers): EtsyRateHeaders {
  return {
    qpsLimit: numericHeader(headers, ["x-limit-per-second"]),
    // Etsy's documentation historically exposed the truncated "secon"
    // spelling; accept both forms because the live API has used both.
    qpsRemaining: numericHeader(headers, [
      "x-remaining-this-second",
      "x-remaining-this-secon",
      "x-rate-limit-remaining",
    ]),
    qpdLimit: numericHeader(headers, ["x-limit-per-day"]),
    qpdRemaining: numericHeader(headers, [
      "x-remaining-today",
      "x-rate-limit-daily-remaining",
    ]),
  };
}

export function retryDecision(error: unknown, attempt: number): RetryDecision {
  if (error instanceof EtsyApiError) {
    if (error.status === 429) {
      return {
        action: "rate_limit",
        delaySeconds: Math.max(1, error.retryAfterSeconds ?? 60),
        code: error.code,
      };
    }
    if (error.status === 401 || error.status === 403) {
      return { action: "reauthorize", code: error.code };
    }
    if (error.status >= 400 && error.status < 500) {
      return { action: "fail", code: error.code };
    }
  }
  const exponential = Math.min(
    MAX_RETRY_DELAY_SECONDS,
    Math.max(5, 5 * 2 ** Math.max(0, attempt - 1)),
  );
  // Deterministic jitter keeps tests stable while preventing every attempt
  // number from retrying on the exact exponential boundary.
  const jitter = (attempt * 17) % Math.max(1, Math.floor(exponential / 4));
  return {
    action: "retry",
    delaySeconds: exponential + jitter,
    code: "sync_task_retryable",
  };
}

export const DEFAULT_SOFT_QPD_RESERVE = 300;

// Etsy's QPD window is a rolling ~24h period, not a calendar-day reset. A
// stored qpd_remaining reading older than this can no longer be trusted to
// reflect the current window — Etsy may have already replenished quota that
// our last observation never saw, so we must not soft-pause a brand new job
// off a reading this old (e.g. left over from a previous session's testing).
export const QPD_READING_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function preflightDelaySeconds(
  state: {
    qpsRemaining: number | null;
    qpdRemaining: number | null;
    blockedUntil: string | null;
    lastResponseAt?: string | null;
    softQpdReserve?: number | null;
  },
  now: Date,
): number {
  if (state.blockedUntil) {
    const blocked = Date.parse(state.blockedUntil);
    if (Number.isFinite(blocked) && blocked > now.getTime()) {
      return Math.max(1, Math.ceil((blocked - now.getTime()) / 1000));
    }
    if (Number.isFinite(blocked)) return 0;
  }
  const reserve =
    typeof state.softQpdReserve === "number" && state.softQpdReserve >= 0
      ? state.softQpdReserve
      : DEFAULT_SOFT_QPD_RESERVE;
  // Soft stop before hard exhaustion so remaining work can resume tomorrow.
  const qpdFloor = Math.max(1, reserve);
  const lastResponse = Date.parse(state.lastResponseAt ?? "");
  const hasLastResponse = Number.isFinite(lastResponse);
  const readingAgeMs = hasLastResponse ? now.getTime() - lastResponse : null;
  const qpdReadingIsStale =
    readingAgeMs != null && readingAgeMs > QPD_READING_STALE_AFTER_MS;
  if (
    !qpdReadingIsStale &&
    state.qpdRemaining != null &&
    state.qpdRemaining <= qpdFloor
  ) {
    // QPD is a rolling window. After a guarded interval, permit one probe so
    // fresh Etsy headers can resume the queue without a user click.
    if (!hasLastResponse || (readingAgeMs as number) < 15 * 60 * 1000) {
      return 15 * 60;
    }
  }
  if (state.qpsRemaining != null && state.qpsRemaining <= 0) return 1;
  return 0;
}

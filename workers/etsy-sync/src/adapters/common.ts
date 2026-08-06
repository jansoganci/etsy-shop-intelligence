import type { EtsyRateHeaders } from "../engine/rateLimit";

export const NO_RATE_HEADERS: EtsyRateHeaders = {
  qpsLimit: null,
  qpsRemaining: null,
  qpdLimit: null,
  qpdRemaining: null,
};

export function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

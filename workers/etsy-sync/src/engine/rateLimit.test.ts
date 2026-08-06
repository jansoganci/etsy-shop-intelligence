import { describe, expect, it } from "vitest";
import { EtsyApiError } from "../etsy";
import {
  preflightDelaySeconds,
  readEtsyRateHeaders,
  retryDecision,
} from "./rateLimit";

describe("shared Etsy rate-limit controller", () => {
  it("reads both documented and live QPS header spellings", () => {
    const headers = new Headers({
      "x-limit-per-second": "10",
      "x-remaining-this-secon": "3",
      "x-limit-per-day": "10000",
      "x-remaining-today": "4567",
    });
    expect(readEtsyRateHeaders(headers)).toEqual({
      qpsLimit: 10,
      qpsRemaining: 3,
      qpdLimit: 10000,
      qpdRemaining: 4567,
    });
  });

  it("uses Retry-After for a 429", () => {
    const decision = retryDecision(
      new EtsyApiError(429, "etsy_rate_limited", "slow down", 37),
      1,
    );
    expect(decision).toEqual({
      action: "rate_limit",
      delaySeconds: 37,
      code: "etsy_rate_limited",
    });
  });

  it("pauses automatically when QPD is exhausted", () => {
    expect(
      preflightDelaySeconds(
        { qpsRemaining: 10, qpdRemaining: 0, blockedUntil: null, softQpdReserve: 0 },
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe(900);
  });

  it("pauses at the soft QPD reserve before hard exhaustion", () => {
    expect(
      preflightDelaySeconds(
        {
          qpsRemaining: 10,
          qpdRemaining: 300,
          blockedUntil: null,
          softQpdReserve: 300,
        },
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe(900);
  });

  it("automatically permits a QPD probe after the guarded interval", () => {
    expect(
      preflightDelaySeconds(
        {
          qpsRemaining: 10,
          qpdRemaining: 0,
          blockedUntil: null,
          softQpdReserve: 0,
          lastResponseAt: "2026-07-25T11:44:00Z",
        },
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe(0);
  });

  it("ignores a stale QPD reading from a previous window instead of soft-pausing a fresh job", () => {
    // Etsy reported ~9,810 remaining today, but the stored row is a leftover
    // low reading from more than 24h ago (e.g. earlier dev/testing). It must
    // not block the very first task of a brand new production sync.
    expect(
      preflightDelaySeconds(
        {
          qpsRemaining: 10,
          qpdRemaining: 0,
          blockedUntil: null,
          softQpdReserve: 300,
          lastResponseAt: "2026-07-24T10:00:00Z",
        },
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe(0);
  });

  it("still soft-pauses when the low QPD reading is recent (not stale)", () => {
    expect(
      preflightDelaySeconds(
        {
          qpsRemaining: 10,
          qpdRemaining: 100,
          blockedUntil: null,
          softQpdReserve: 300,
          lastResponseAt: "2026-07-25T11:58:00Z",
        },
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe(900);
  });

  it("honors a future blocked-until checkpoint", () => {
    expect(
      preflightDelaySeconds(
        {
          qpsRemaining: 10,
          qpdRemaining: 100,
          blockedUntil: "2026-07-25T12:01:00Z",
          softQpdReserve: 0,
        },
        new Date("2026-07-25T12:00:00Z"),
      ),
    ).toBe(60);
  });
});

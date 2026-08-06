import { describe, expect, it } from "vitest";
import {
  MAX_COMMERCE_RANGE_DAYS,
  parseCommercePeriod,
  toEtsyWindow,
} from "./period";

const AFTER_AUG_2026 = new Date("2026-09-01T12:00:00.000Z");

describe("parseCommercePeriod", () => {
  it.each([
    {
      name: "valid month",
      from: "2026-07-01",
      to: "2026-07-31",
      now: AFTER_AUG_2026,
      expected: {
        ok: true,
        period: {
          fromTs: Date.UTC(2026, 6, 1) / 1000,
          toExclusiveTs: Date.UTC(2026, 7, 1) / 1000,
        },
      },
    },
    {
      name: "single day",
      from: "2026-07-15",
      to: "2026-07-15",
      now: AFTER_AUG_2026,
      expected: {
        ok: true,
        period: {
          fromTs: Date.UTC(2026, 6, 15) / 1000,
          toExclusiveTs: Date.UTC(2026, 6, 16) / 1000,
        },
      },
    },
    {
      name: "reversed",
      from: "2026-07-31",
      to: "2026-07-01",
      now: AFTER_AUG_2026,
      expected: { ok: false, error: "invalid_period_order" },
    },
    {
      name: "future",
      from: "2026-07-01",
      to: "2026-12-31",
      now: AFTER_AUG_2026,
      expected: { ok: false, error: "period_in_future" },
    },
    {
      name: "366+1 days",
      from: "2025-01-01",
      to: "2026-01-02",
      now: new Date("2027-01-01T00:00:00.000Z"),
      expected: { ok: false, error: "period_too_large" },
    },
    {
      name: "malformed",
      from: "2026/07/01",
      to: "2026-07-31",
      now: AFTER_AUG_2026,
      expected: { ok: false, error: "invalid_period_format" },
    },
    {
      name: "invalid calendar date",
      from: "2026-02-30",
      to: "2026-07-31",
      now: AFTER_AUG_2026,
      expected: { ok: false, error: "invalid_period_format" },
    },
    {
      name: "pre-2000",
      from: "1999-12-31",
      to: "2000-01-01",
      now: AFTER_AUG_2026,
      expected: { ok: false, error: "period_before_etsy_epoch" },
    },
  ])("$name", ({ from, to, now, expected }) => {
    expect(parseCommercePeriod(from, to, now)).toEqual(expected);
  });

  it("uses half-open UTC calendar day boundaries for a full month", () => {
    const result = parseCommercePeriod("2026-07-01", "2026-07-31", AFTER_AUG_2026);
    expect(result).toEqual({
      ok: true,
      period: {
        fromTs: Date.UTC(2026, 6, 1) / 1000,
        toExclusiveTs: Date.UTC(2026, 7, 1) / 1000,
      },
    });
  });

  it("clamps a range ending today to floor(now/1000)+1", () => {
    const now = new Date("2026-08-05T15:30:45.123Z");
    const result = parseCommercePeriod("2026-08-01", "2026-08-05", now);
    expect(result).toEqual({
      ok: true,
      period: {
        fromTs: Date.UTC(2026, 7, 1) / 1000,
        toExclusiveTs: Math.floor(now.getTime() / 1000) + 1,
      },
    });
  });

  it("allows to equal today's UTC calendar date", () => {
    const now = new Date("2026-08-05T15:30:45.123Z");
    const result = parseCommercePeriod("2026-08-05", "2026-08-05", now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.period.toExclusiveTs).toBe(Math.floor(now.getTime() / 1000) + 1);
    }
  });

  it("accepts a range spanning exactly MAX_COMMERCE_RANGE_DAYS", () => {
    const now = new Date("2027-01-01T00:00:00.000Z");
    const result = parseCommercePeriod("2025-01-01", "2026-01-01", now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.period.toExclusiveTs - result.period.fromTs).toBe(
        MAX_COMMERCE_RANGE_DAYS * 86_400,
      );
    }
  });
});

describe("toEtsyWindow", () => {
  it("maps the half-open period to inclusive Etsy min/max_created bounds", () => {
    const period = {
      fromTs: Date.UTC(2026, 6, 1) / 1000,
      toExclusiveTs: Date.UTC(2026, 7, 1) / 1000,
    };
    expect(toEtsyWindow(period)).toEqual({
      minCreated: period.fromTs,
      maxCreated: period.toExclusiveTs - 1,
    });
  });
});

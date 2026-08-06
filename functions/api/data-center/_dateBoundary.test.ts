import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORTING_TIMEZONE,
  summarizeBoundaryShifts,
  toReportingDate,
  toReportingMonth,
  toUtcDate,
  toUtcMonth,
} from "./_dateBoundary";

function epochOf(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

describe("toReportingDate / toUtcDate", () => {
  it("1. UTC gün sonu: 21:30 UTC on the current (fixed +03:00) era rolls to the next Istanbul day", () => {
    const epoch = epochOf("2026-07-24T21:30:00Z");
    expect(toUtcDate(epoch)).toBe("2026-07-24");
    expect(toReportingDate(epoch)).toBe("2026-07-25");
  });

  it("a UTC time too early to roll over stays on the same Istanbul day", () => {
    const epoch = epochOf("2026-07-24T10:00:00Z");
    expect(toReportingDate(epoch)).toBe("2026-07-24");
  });

  it("2. ay sonu: the last day of a month at a late UTC hour rolls into the first day of the next month", () => {
    const epoch = epochOf("2026-06-30T22:00:00Z");
    expect(toUtcMonth(epoch)).toBe("2026-06");
    expect(toReportingMonth(epoch)).toBe("2026-07");
  });

  it("3. yıl sonu: Dec 31 late UTC rolls into Jan 1 of the next year in Istanbul", () => {
    const epoch = epochOf("2025-12-31T22:00:00Z");
    expect(toReportingDate(epoch)).toBe("2026-01-01");
    expect(toReportingMonth(epoch)).toBe("2026-01");
  });

  it("4. historical DST: a 2015 winter UTC+2 record does NOT roll over at a UTC hour that would only roll under +03:00", () => {
    // Turkey observed real EET(+2)/EEST(+3) DST until switching to a
    // permanent UTC+3 in 2016. Feb 10 2015 21:30 UTC is winter standard
    // time (+2): local time is 23:30, same day. A hardcoded "+03:00"
    // offset would wrongly compute 00:30 the next day. This is the exact
    // scenario the plan warns about (§7.6) -- proving Intl's ICU tzdata,
    // not a fixed offset, is actually driving the result.
    const epoch = epochOf("2015-02-10T21:30:00Z");
    expect(toReportingDate(epoch)).toBe("2015-02-10");
  });

  it("historical DST: a 2015 summer UTC+3 record DOES roll over at the same UTC hour", () => {
    // Same UTC hour, but EEST (summer DST, +3) was in effect in July 2015,
    // so this one should roll to the next day -- confirming the function
    // tracks the actual historical DST calendar, not a fixed year-round rate.
    const epoch = epochOf("2015-07-10T21:30:00Z");
    expect(toReportingDate(epoch)).toBe("2015-07-11");
  });

  it("a custom IANA timezone is honored instead of the Europe/Istanbul default", () => {
    const epoch = epochOf("2026-07-24T23:30:00Z");
    expect(toReportingDate(epoch, "UTC")).toBe("2026-07-24");
    expect(toReportingDate(epoch, "America/New_York")).toBe("2026-07-24");
  });

  it("DEFAULT_REPORTING_TIMEZONE is Europe/Istanbul, matching the plan's default reporting timezone", () => {
    expect(DEFAULT_REPORTING_TIMEZONE).toBe("Europe/Istanbul");
  });
});

describe("summarizeBoundaryShifts", () => {
  it("a record whose UTC and reporting month match is not counted as shifted", () => {
    const rows = [{ id: "r1", epoch: epochOf("2026-07-24T10:00:00Z"), amount: 100 }];
    const result = summarizeBoundaryShifts(rows);
    expect(result.shiftedRecordCount).toBe(0);
    expect(result.monthPairs).toEqual([]);
  });

  it("5. CSV date-only ambiguity is out of scope by construction: this function only ever consumes API epoch timestamps, never a CSV date string, so there is nothing to (mis)reinterpret", () => {
    // Documented as a design guard rather than a runtime assertion: the
    // BoundaryRow type only has a numeric `epoch`, so a CSV date-only
    // string could not be passed in even by mistake without a type error.
    const rows = [{ id: "r1", epoch: epochOf("2026-06-30T22:00:00Z"), amount: 50 }];
    const result = summarizeBoundaryShifts(rows);
    expect(result.monthPairs[0]).toEqual({ sourceMonth: "2026-06", reportingMonth: "2026-07", count: 1 });
  });

  it("a same-month day shift (no month change) is not counted, since it cannot affect any monthly total", () => {
    const rows = [{ id: "r1", epoch: epochOf("2026-07-24T21:30:00Z"), amount: 10 }];
    // toUtcDate=2026-07-24, toReportingDate=2026-07-25, but same month (2026-07).
    const result = summarizeBoundaryShifts(rows);
    expect(result.shiftedRecordCount).toBe(0);
  });

  it("aggregates multiple shifted records into the correct month-pair buckets and sums their amounts", () => {
    const rows = [
      { id: "r1", epoch: epochOf("2026-06-30T22:00:00Z"), amount: 100 },
      { id: "r2", epoch: epochOf("2026-06-30T23:00:00Z"), amount: 50 },
      { id: "r3", epoch: epochOf("2025-12-31T22:00:00Z"), amount: 25 },
    ];
    const result = summarizeBoundaryShifts(rows);
    expect(result.shiftedRecordCount).toBe(3);
    expect(result.shiftedAmount).toBeCloseTo(175, 8);
    expect(result.monthPairs).toEqual([
      { sourceMonth: "2025-12", reportingMonth: "2026-01", count: 1 },
      { sourceMonth: "2026-06", reportingMonth: "2026-07", count: 2 },
    ]);
    // r1 and r2 both shift 2026-06 -> 2026-07 and must be merged into one bucket.
    const juneToJuly = result.monthPairs.find((pair) => pair.sourceMonth === "2026-06");
    expect(juneToJuly?.count).toBe(2);
  });

  it("a null amount on a shifted record does not corrupt shiftedAmount for the other records", () => {
    const rows = [
      { id: "r1", epoch: epochOf("2026-06-30T22:00:00Z"), amount: 100 },
      { id: "r2", epoch: epochOf("2026-06-30T23:00:00Z"), amount: null },
    ];
    const result = summarizeBoundaryShifts(rows);
    expect(result.shiftedRecordCount).toBe(2);
    expect(result.shiftedAmount).toBeCloseTo(100, 8);
  });

  it("no rows at all => zero shifts, not unavailable (that distinction is made by the caller)", () => {
    const result = summarizeBoundaryShifts([]);
    expect(result.available).toBe(true);
    expect(result.shiftedRecordCount).toBe(0);
    expect(result.shiftedAmount).toBeNull();
  });
});

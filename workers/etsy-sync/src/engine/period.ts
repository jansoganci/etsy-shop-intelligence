import { ETSY_EPOCH_MIN } from "./planner";

export type CommercePeriod = {
  fromTs: number; // inclusive, UTC epoch seconds
  toExclusiveTs: number; // exclusive, UTC epoch seconds
};

export const MAX_COMMERCE_RANGE_DAYS = 366;
export { ETSY_EPOCH_MIN };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECONDS_PER_DAY = 86_400;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function parseUtcCalendarDate(value: string): CalendarDate | null {
  if (!DATE_RE.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day);
  const probe = new Date(utcMs);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function utcDateToTs(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 1000);
}

function isAfterUtcCalendarDate(date: CalendarDate, now: Date): boolean {
  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth() + 1;
  const todayDay = now.getUTCDate();

  if (date.year !== todayYear) {
    return date.year > todayYear;
  }
  if (date.month !== todayMonth) {
    return date.month > todayMonth;
  }
  return date.day > todayDay;
}

export function parseCommercePeriod(
  from: string,
  to: string,
  now: Date,
): { ok: true; period: CommercePeriod } | { ok: false; error: string } {
  const fromDate = parseUtcCalendarDate(from);
  const toDate = parseUtcCalendarDate(to);
  if (!fromDate || !toDate) {
    return { ok: false, error: "invalid_period_format" };
  }

  const fromTs = utcDateToTs(fromDate);
  let toExclusiveTs = utcDateToTs(toDate) + SECONDS_PER_DAY;

  if (fromTs < ETSY_EPOCH_MIN) {
    return { ok: false, error: "period_before_etsy_epoch" };
  }

  if (fromTs >= toExclusiveTs) {
    return { ok: false, error: "invalid_period_order" };
  }

  if (isAfterUtcCalendarDate(toDate, now)) {
    return { ok: false, error: "period_in_future" };
  }

  const nowExclusiveCap = Math.floor(now.getTime() / 1000) + 1;
  if (toExclusiveTs > nowExclusiveCap) {
    toExclusiveTs = nowExclusiveCap;
  }

  const maxSpanSeconds = MAX_COMMERCE_RANGE_DAYS * SECONDS_PER_DAY;
  if (toExclusiveTs - fromTs > maxSpanSeconds) {
    return { ok: false, error: "period_too_large" };
  }

  return {
    ok: true,
    period: { fromTs, toExclusiveTs },
  };
}

export function toEtsyWindow(p: CommercePeriod) {
  return { minCreated: p.fromTs, maxCreated: p.toExclusiveTs - 1 };
}

import type { CommercePeriodInput, CommerceSyncStage } from "../../../data/types/etsyApi";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type CommercePeriodValidationError =
  | "invalid_format"
  | "future_date"
  | "reversed_range";

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

function calendarDateToInput(date: CalendarDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
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

export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcMonthPeriod(year: number, month: number): CommercePeriodInput {
  const fromDate: CalendarDate = { year, month, day: 1 };
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: calendarDateToInput(fromDate),
    to: calendarDateToInput({ year, month, day: lastDay }),
  };
}

export function thisUtcMonth(now: Date = new Date()): CommercePeriodInput {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return {
    from: calendarDateToInput({ year, month, day: 1 }),
    to: formatUtcDate(now),
  };
}

export function previousUtcMonths(
  count: number,
  now: Date = new Date(),
): CommercePeriodInput[] {
  const periods: CommercePeriodInput[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;

  for (let index = 0; index < count; index += 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    periods.push(utcMonthPeriod(year, month));
  }

  return periods;
}

export function isFutureUtcDate(value: string, now: Date = new Date()): boolean {
  const parsed = parseUtcCalendarDate(value);
  if (!parsed) {
    return true;
  }
  return isAfterUtcCalendarDate(parsed, now);
}

export function validateCommercePeriodInput(
  from: string,
  to: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; error: CommercePeriodValidationError } {
  const fromDate = parseUtcCalendarDate(from);
  const toDate = parseUtcCalendarDate(to);
  if (!fromDate || !toDate) {
    return { ok: false, error: "invalid_format" };
  }

  if (isAfterUtcCalendarDate(fromDate, now) || isAfterUtcCalendarDate(toDate, now)) {
    return { ok: false, error: "future_date" };
  }

  const fromTs = Date.UTC(fromDate.year, fromDate.month - 1, fromDate.day);
  const toTs = Date.UTC(toDate.year, toDate.month - 1, toDate.day);
  if (fromTs > toTs) {
    return { ok: false, error: "reversed_range" };
  }

  return { ok: true };
}

export function computeSyncProgress(completed: number, total: number): number {
  const safeTotal = Math.max(total, 1);
  const ratio = completed / safeTotal;
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return Math.min(1, Math.max(0, ratio));
}

export function commerceStageLabel(stage: CommerceSyncStage): string {
  switch (stage) {
    case "queued":
      return "Kuyrukta";
    case "shop":
      return "Mağaza";
    case "receipts":
      return "Siparişler";
    case "payments":
      return "Ödemeler";
    case "ledger":
      return "Defter";
    case "finishing":
      return "Tamamlanıyor";
  }
}

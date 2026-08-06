import type { ParsedReportFilters, ReportCompareMode } from "./_filters";
import { formatCount, formatMoney, formatPercent, toNumber } from "./_money";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type SummaryRequestContext = {
  request: Request;
  env: {
    DB: D1Database;
  };
};

export type KpiCard = {
  key: string;
  label: string;
  value: number | string | null;
  formattedValue: string;
  currency?: string | null;
  unit?: "count" | "percent" | "money" | "ratio" | "days" | null;
  previousValue?: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
  direction?: "up" | "down" | "flat" | "unknown";
  note?: string;
};

export type InsightBlock = {
  key: string;
  title: string;
  severity: "positive" | "warning" | "neutral" | "opportunity";
  message: string;
  metricKeys?: string[];
  action?: string;
};

type JsonScalar = string | boolean | null;

type DateRange = {
  from: string | null;
  to: string | null;
};

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, dayCount: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + dayCount);
  return next;
}

function differenceInDaysInclusive(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function getComparisonDateRange(filters: ParsedReportFilters): {
  mode: ReportCompareMode;
  from: string | null;
  to: string | null;
} {
  if (
    filters.compare === "none"
    || !filters.dateFrom
    || !filters.dateTo
  ) {
    return {
      mode: filters.compare,
      from: null,
      to: null,
    };
  }

  if (filters.compare === "previous_period") {
    const dayCount = differenceInDaysInclusive(filters.dateFrom, filters.dateTo);
    const currentStart = parseIsoDate(filters.dateFrom);
    const previousEnd = addDays(currentStart, -1);
    const previousStart = addDays(previousEnd, -(dayCount - 1));

    return {
      mode: filters.compare,
      from: toIsoDate(previousStart),
      to: toIsoDate(previousEnd),
    };
  }

  const currentFrom = parseIsoDate(filters.dateFrom);
  const currentTo = parseIsoDate(filters.dateTo);
  currentFrom.setUTCFullYear(currentFrom.getUTCFullYear() - 1);
  currentTo.setUTCFullYear(currentTo.getUTCFullYear() - 1);

  return {
    mode: filters.compare,
    from: toIsoDate(currentFrom),
    to: toIsoDate(currentTo),
  };
}

export function withComparisonDateRange(
  filters: ParsedReportFilters,
  comparison: DateRange,
): ParsedReportFilters {
  return {
    ...filters,
    dateFrom: comparison.from,
    dateTo: comparison.to,
  };
}

export function jsonError(status: number, error: string): Response {
  return Response.json(
    {
      ok: false,
      error,
    },
    { status },
  );
}

export async function queryAll<T>(
  db: D1Database,
  query: string,
  bindings: unknown[] = [],
): Promise<T[]> {
  const result = await db.prepare(query).bind(...bindings).all<T>();
  return result.results ?? [];
}

export async function queryFirst<T>(
  db: D1Database,
  query: string,
  bindings: unknown[] = [],
): Promise<T | null> {
  return db.prepare(query).bind(...bindings).first<T>();
}

export function buildDirection(current: number | null, previous: number | null): "up" | "down" | "flat" | "unknown" {
  if (current === null || previous === null) {
    return "unknown";
  }

  if (current > previous) {
    return "up";
  }

  if (current < previous) {
    return "down";
  }

  return "flat";
}

export function buildDelta(current: number | null, previous: number | null): {
  previousValue: number | null;
  delta: number | null;
  deltaPercent: number | null;
  direction: "up" | "down" | "flat" | "unknown";
} {
  if (current === null || previous === null) {
    return {
      previousValue: previous,
      delta: null,
      deltaPercent: null,
      direction: "unknown",
    };
  }

  const delta = current - previous;
  return {
    previousValue: previous,
    delta,
    deltaPercent: previous === 0 ? null : delta / previous,
    direction: previous === 0 ? "unknown" : buildDirection(current, previous),
  };
}

export function buildCountKpi(
  key: string,
  label: string,
  value: number | null,
  previousValue: number | null = null,
  note?: string,
): KpiCard {
  return {
    key,
    label,
    value,
    formattedValue: formatCount(value),
    unit: "count",
    ...buildDelta(value, previousValue),
    note,
  };
}

export function buildPercentKpi(
  key: string,
  label: string,
  value: number | null,
  previousValue: number | null = null,
  note?: string,
): KpiCard {
  return {
    key,
    label,
    value,
    formattedValue: formatPercent(value),
    unit: "percent",
    ...buildDelta(value, previousValue),
    note,
  };
}

export function buildMoneyKpi(
  key: string,
  label: string,
  amount: number | null,
  currency: string | null,
  previousValue: number | null = null,
  note?: string,
): KpiCard {
  return {
    key,
    label,
    value: amount,
    formattedValue: amount === null ? "N/A" : formatMoney(amount, currency),
    currency,
    unit: "money",
    ...buildDelta(amount, previousValue),
    note,
  };
}

export function buildRatioKpi(
  key: string,
  label: string,
  value: number | null,
  previousValue: number | null = null,
  note?: string,
): KpiCard {
  return {
    key,
    label,
    value,
    formattedValue: value === null ? "N/A" : formatCount(value),
    unit: "ratio",
    ...buildDelta(value, previousValue),
    note,
  };
}

export function buildDaysKpi(
  key: string,
  label: string,
  value: number | null,
  previousValue: number | null = null,
  note?: string,
): KpiCard {
  return {
    key,
    label,
    value,
    formattedValue: value === null ? "N/A" : `${toNumber(value).toFixed(1)} days`,
    unit: "days",
    ...buildDelta(value, previousValue),
    note,
  };
}

export function serializeFilters(filters: ParsedReportFilters): Record<string, JsonScalar> {
  return {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    country: filters.country,
    city: filters.city,
    currency: filters.currency,
    couponUsed: filters.couponUsed,
    couponCode: filters.couponCode,
    status: filters.status,
    orderId: filters.orderId,
    listingId: filters.listingId,
    paymentId: filters.paymentId,
    q: filters.q,
    compare: filters.compare,
  };
}

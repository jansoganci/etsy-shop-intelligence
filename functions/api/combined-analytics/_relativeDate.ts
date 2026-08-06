const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_AGO_PATTERN = /^(\d+)daysAgo$/;

function parseAnchorToUtcDate(anchorIso: string): Date | null {
  const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(anchorIso);
  const normalized = hasTimezone ? anchorIso : `${anchorIso.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftUtcDays(anchor: Date, days: number): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - days));
}

function resolveSingleGaDate(value: string, anchor: Date): string | null {
  const trimmed = value.trim();

  if (ISO_DATE_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (trimmed === "today") {
    return formatUtcDate(anchor);
  }
  if (trimmed === "yesterday") {
    return formatUtcDate(shiftUtcDays(anchor, 1));
  }

  const daysAgoMatch = DAYS_AGO_PATTERN.exec(trimmed);
  if (daysAgoMatch) {
    return formatUtcDate(shiftUtcDays(anchor, Number(daysAgoMatch[1])));
  }

  return null;
}

/**
 * Resolves GA4's relative date syntax ("30daysAgo", "today", "yesterday") --
 * or an already-ISO date -- into a real calendar date, anchored to a known
 * real timestamp (e.g. the row's own `synced_at`). Returns null if either
 * side uses a format we don't recognize, rather than guessing.
 */
export function resolveGaDateRange(
  dateFrom: string,
  dateTo: string,
  anchorIso: string,
): { from: string; to: string } | null {
  const anchor = parseAnchorToUtcDate(anchorIso);
  if (!anchor) {
    return null;
  }

  const from = resolveSingleGaDate(dateFrom, anchor);
  const to = resolveSingleGaDate(dateTo, anchor);

  return from && to ? { from, to } : null;
}

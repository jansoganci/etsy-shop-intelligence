import type { D1DatabaseWithAll } from "./_financialReconciliation";
import type { EntityReconciliation } from "./_reconciliation";

// ---------------------------------------------------------------------------
// Phase 4: reporting-timezone date boundaries. SQLite's date()/strftime() only
// support fixed UTC offsets (or OS local time) -- neither is safe here,
// because Turkey observed real DST (EET/EEST, UTC+2/+3) until switching to a
// permanent UTC+3 in 2016. A hardcoded "+03:00" would silently misclassify
// historical winter records. Intl.DateTimeFormat with an IANA zone name is
// ICU-backed and gets this right for both eras, so all reporting-timezone
// conversion happens in JS, not SQL.
// ---------------------------------------------------------------------------

export const DEFAULT_REPORTING_TIMEZONE = "Europe/Istanbul";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // en-CA formats as YYYY-MM-DD, which is what every date column in this
    // feature already uses as its comparable string form.
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function toReportingDate(epochSeconds: number, timeZone: string = DEFAULT_REPORTING_TIMEZONE): string {
  return getFormatter(timeZone).format(new Date(epochSeconds * 1000));
}

export function toReportingMonth(epochSeconds: number, timeZone: string = DEFAULT_REPORTING_TIMEZONE): string {
  return toReportingDate(epochSeconds, timeZone).slice(0, 7);
}

export function toUtcDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function toUtcMonth(epochSeconds: number): string {
  return toUtcDate(epochSeconds).slice(0, 7);
}

export type BoundaryRow = { id: string; epoch: number; amount: number | null };

export type MonthShiftPair = { sourceMonth: string; reportingMonth: string; count: number };

export type DateBoundarySummary = {
  timezone: string;
  available: boolean;
  shiftedRecordCount: number;
  shiftedAmount: number | null;
  monthPairs: MonthShiftPair[];
};

const UNAVAILABLE_SUMMARY = (timeZone: string): DateBoundarySummary => ({
  timezone: timeZone,
  available: false,
  shiftedRecordCount: 0,
  shiftedAmount: null,
  monthPairs: [],
});

/**
 * A record only ever shifts to the *next* reporting-calendar month, never the
 * previous one, because Istanbul is always ahead of UTC (+2 or +3). Only
 * records created late in the UTC day can cross that boundary, so this only
 * flags month-level shifts (the granularity the monthly financial
 * reconciliation actually cares about) -- a same-month day shift has no
 * effect on any total this app computes and is intentionally not counted.
 */
export function summarizeBoundaryShifts(rows: BoundaryRow[], timeZone: string = DEFAULT_REPORTING_TIMEZONE): DateBoundarySummary {
  const pairs = new Map<string, MonthShiftPair>();
  let shiftedRecordCount = 0;
  let shiftedAmount = 0;
  let hasAmount = false;

  for (const row of rows) {
    const sourceMonth = toUtcMonth(row.epoch);
    const reportingMonth = toReportingMonth(row.epoch, timeZone);
    if (sourceMonth === reportingMonth) continue;

    shiftedRecordCount += 1;
    if (row.amount !== null && Number.isFinite(row.amount)) {
      shiftedAmount += row.amount;
      hasAmount = true;
    }

    const key = `${sourceMonth}->${reportingMonth}`;
    const existing = pairs.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      pairs.set(key, { sourceMonth, reportingMonth, count: 1 });
    }
  }

  return {
    timezone: timeZone,
    available: true,
    shiftedRecordCount,
    shiftedAmount: hasAmount ? shiftedAmount : null,
    monthPairs: Array.from(pairs.values()).sort((a, b) => a.sourceMonth.localeCompare(b.sourceMonth)),
  };
}

// Only rows in the last hours of the UTC day can possibly roll into the next
// reporting-calendar day; >=21 is a safe superset covering both the +2
// (pre-2016) and +3 (current) Istanbul offsets, so no candidate is missed.
const CANDIDATE_UTC_HOUR = 21;

async function loadCandidates(
  db: D1DatabaseWithAll,
  entity: "orders" | "payments",
  range: { min: string | null; max: string | null },
): Promise<BoundaryRow[]> {
  const query =
    entity === "orders"
      ? `
        SELECT
          receipt_id AS id,
          create_timestamp AS epoch,
          CASE WHEN total_price_divisor > 0 THEN total_price_amount * 1.0 / total_price_divisor END AS amount
        FROM etsy_api_receipts
        WHERE date(create_timestamp, 'unixepoch') BETWEEN ? AND ?
          AND CAST(strftime('%H', datetime(create_timestamp, 'unixepoch')) AS INTEGER) >= ${CANDIDATE_UTC_HOUR}
      `
      : `
        SELECT
          payment_id AS id,
          create_timestamp AS epoch,
          CASE WHEN amount_gross_divisor > 0 THEN amount_gross * 1.0 / amount_gross_divisor END AS amount
        FROM etsy_api_payments
        WHERE date(create_timestamp, 'unixepoch') BETWEEN ? AND ?
          AND CAST(strftime('%H', datetime(create_timestamp, 'unixepoch')) AS INTEGER) >= ${CANDIDATE_UTC_HOUR}
      `;
  const result = await db.prepare(query).bind(range.min, range.max).all<BoundaryRow>();
  return result.results ?? [];
}

export type DateBoundaryResult = {
  orders: DateBoundarySummary;
  payments: DateBoundarySummary;
};

export async function detectDateBoundaryShifts(
  db: D1DatabaseWithAll,
  orders: EntityReconciliation,
  payments: EntityReconciliation,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
): Promise<DateBoundaryResult> {
  const ordersReady = orders.readiness.api && Boolean(orders.coverage.common.min && orders.coverage.common.max);
  const paymentsReady = payments.readiness.api && Boolean(payments.coverage.common.min && payments.coverage.common.max);

  const [orderRows, paymentRows] = await Promise.all([
    ordersReady ? loadCandidates(db, "orders", orders.coverage.common) : Promise.resolve([]),
    paymentsReady ? loadCandidates(db, "payments", payments.coverage.common) : Promise.resolve([]),
  ]);

  return {
    orders: ordersReady ? summarizeBoundaryShifts(orderRows, timeZone) : UNAVAILABLE_SUMMARY(timeZone),
    payments: paymentsReady ? summarizeBoundaryShifts(paymentRows, timeZone) : UNAVAILABLE_SUMMARY(timeZone),
  };
}

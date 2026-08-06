import type { D1DatabaseWithAll } from "./_financialReconciliation";
import type { DateRange } from "./_reconciliation";

// ---------------------------------------------------------------------------
// Phase 5: request-time drill-down from an aggregate mismatch to the actual
// problem records. No persisted match/issue tables (plan §4.2/§4.4) -- this
// stays request-time computed, matching every earlier phase's architecture,
// so it needs no migration. Composite/tolerant matching (plan §5.3) is
// explicitly out of scope: exact ID is the only matching method here.
//
// PII allowlist: only id, date, amount, currency and (for parent_mismatch)
// the two parent IDs are ever selected. No buyer name/address/email column
// is referenced by any query in this file.
// ---------------------------------------------------------------------------

export type IssueEntity = "orders" | "orderItems" | "payments";
export type IssueType = "missing_in_api" | "missing_in_csv" | "orphan_api" | "orphan_csv" | "parent_mismatch";

export type IssueRecord = {
  id: string;
  date: string | null;
  amount: number | null;
  currency: string | null;
  detail?: string;
};

export type IssuesPage = {
  entity: IssueEntity;
  type: IssueType;
  items: IssueRecord[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export const VALID_ISSUE_TYPES_BY_ENTITY: Record<IssueEntity, IssueType[]> = {
  orders: ["missing_in_api", "missing_in_csv"],
  orderItems: ["missing_in_api", "missing_in_csv", "orphan_api", "orphan_csv", "parent_mismatch"],
  payments: ["missing_in_api", "missing_in_csv", "orphan_api", "orphan_csv", "parent_mismatch"],
};

export function isValidIssueRequest(entity: string, type: string): entity is IssueEntity {
  return (VALID_ISSUE_TYPES_BY_ENTITY as Record<string, IssueType[]>)[entity]?.includes(type as IssueType) ?? false;
}

export const MAX_ISSUE_PAGE_SIZE = 200;
export const DEFAULT_ISSUE_PAGE_SIZE = 50;

/** Clamps a caller-supplied page size into a safe range instead of trusting it outright. */
export function resolvePageSize(requested: number | null | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return DEFAULT_ISSUE_PAGE_SIZE;
  return Math.min(Math.floor(requested), MAX_ISSUE_PAGE_SIZE);
}

/**
 * Faz6 period filter: narrows the entity's already-validated common-coverage
 * range to a user-requested [from, to] window. Never widens past the base
 * range -- a caller cannot ask to see "issues" outside the window the
 * aggregate reconciliation itself considered comparable (plan §9.7's period
 * filter, applied against the same shared-coverage guarantee from Faz1).
 */
export function clampRangeToPeriod(
  base: DateRange,
  from: string | null | undefined,
  to: string | null | undefined,
): DateRange {
  if (!base.min || !base.max) return base;
  const min = from && from > base.min ? from : base.min;
  const max = to && to < base.max ? to : base.max;
  if (min > max) return { min: null, max: null };
  return { min, max };
}

type IssueQuery = { sql: string; params: unknown[] };

function buildQuery(
  entity: IssueEntity,
  type: IssueType,
  range: DateRange,
  limit: number,
  offset: number,
): IssueQuery | null {
  // Fetch one extra row so the caller can tell whether there is a next page
  // without a second COUNT(*) query.
  const fetchLimit = limit + 1;

  if (entity === "orders") {
    if (type === "missing_in_csv") {
      return {
        sql: `
          SELECT api.receipt_id AS id, date(api.create_timestamp, 'unixepoch') AS date,
            CASE WHEN api.total_price_divisor > 0
              THEN api.total_price_amount * 1.0 / api.total_price_divisor END AS amount,
            api.total_price_currency AS currency
          FROM etsy_api_receipts api
          WHERE NOT EXISTS (SELECT 1 FROM orders csv WHERE csv.order_id = api.receipt_id)
            AND date(api.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY api.create_timestamp DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "missing_in_api") {
      return {
        sql: `
          SELECT csv.order_id AS id, vc.sale_date AS date, csv.order_value AS amount, csv.currency AS currency
          FROM orders csv
          JOIN v_orders_clean vc ON vc.order_id = csv.order_id
          WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts api WHERE csv.order_id = api.receipt_id)
            AND vc.sale_date BETWEEN ? AND ?
          ORDER BY vc.sale_date DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    return null;
  }

  if (entity === "orderItems") {
    if (type === "missing_in_csv") {
      return {
        sql: `
          SELECT api.transaction_id AS id, date(api.create_timestamp, 'unixepoch') AS date,
            CASE WHEN api.price_divisor > 0
              THEN api.price_amount * 1.0 / api.price_divisor * api.quantity END AS amount,
            api.price_currency AS currency
          FROM etsy_api_transactions api
          WHERE NOT EXISTS (SELECT 1 FROM order_items csv WHERE csv.transaction_id = api.transaction_id)
            AND date(api.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY api.create_timestamp DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "missing_in_api") {
      return {
        sql: `
          SELECT csv.transaction_id AS id, vc.sale_date AS date, csv.price AS amount, csv.currency AS currency
          FROM order_items csv
          JOIN v_order_items_clean vc ON vc.transaction_id = csv.transaction_id
          WHERE NOT EXISTS (
            SELECT 1 FROM etsy_api_transactions api WHERE csv.transaction_id = api.transaction_id
          )
            AND vc.sale_date BETWEEN ? AND ?
          ORDER BY vc.sale_date DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "orphan_api") {
      return {
        sql: `
          SELECT t.transaction_id AS id, date(t.create_timestamp, 'unixepoch') AS date,
            CASE WHEN t.price_divisor > 0 THEN t.price_amount * 1.0 / t.price_divisor * t.quantity END AS amount,
            t.price_currency AS currency
          FROM etsy_api_transactions t
          WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts r WHERE r.receipt_id = t.receipt_id)
            AND date(t.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY t.create_timestamp DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "orphan_csv") {
      return {
        sql: `
          SELECT oi.transaction_id AS id, vc.sale_date AS date, oi.price AS amount, oi.currency AS currency
          FROM order_items oi
          LEFT JOIN v_order_items_clean vc ON vc.transaction_id = oi.transaction_id
          WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = oi.order_id)
            AND vc.sale_date BETWEEN ? AND ?
          ORDER BY oi.transaction_id DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "parent_mismatch") {
      return {
        sql: `
          SELECT api.transaction_id AS id, date(api.create_timestamp, 'unixepoch') AS date,
            CASE WHEN api.price_divisor > 0
              THEN api.price_amount * 1.0 / api.price_divisor * api.quantity END AS amount,
            api.price_currency AS currency,
            ('API parent ' || api.receipt_id || ' vs CSV parent ' || csv.order_id) AS detail
          FROM etsy_api_transactions api
          JOIN order_items csv ON csv.transaction_id = api.transaction_id
          WHERE csv.order_id <> api.receipt_id
            AND date(api.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY api.transaction_id
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
  }

  if (entity === "payments") {
    if (type === "missing_in_csv") {
      return {
        sql: `
          SELECT api.payment_id AS id, date(api.create_timestamp, 'unixepoch') AS date,
            CASE WHEN api.amount_gross_divisor > 0
              THEN api.amount_gross * 1.0 / api.amount_gross_divisor END AS amount,
            api.amount_gross_currency AS currency
          FROM etsy_api_payments api
          WHERE NOT EXISTS (SELECT 1 FROM payments csv WHERE csv.payment_id = api.payment_id)
            AND date(api.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY api.create_timestamp DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "missing_in_api") {
      return {
        sql: `
          SELECT csv.payment_id AS id, vc.order_date AS date, csv.gross_amount AS amount, csv.currency AS currency
          FROM payments csv
          JOIN v_payments_clean vc ON vc.payment_id = csv.payment_id
          WHERE NOT EXISTS (SELECT 1 FROM etsy_api_payments api WHERE csv.payment_id = api.payment_id)
            AND vc.order_date BETWEEN ? AND ?
          ORDER BY vc.order_date DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "orphan_api") {
      return {
        sql: `
          SELECT p.payment_id AS id, date(p.create_timestamp, 'unixepoch') AS date,
            CASE WHEN p.amount_gross_divisor > 0
              THEN p.amount_gross * 1.0 / p.amount_gross_divisor END AS amount,
            p.amount_gross_currency AS currency
          FROM etsy_api_payments p
          WHERE NOT EXISTS (SELECT 1 FROM etsy_api_receipts r WHERE r.receipt_id = p.receipt_id)
            AND date(p.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY p.create_timestamp DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "orphan_csv") {
      return {
        sql: `
          SELECT pay.payment_id AS id, vc.order_date AS date, pay.gross_amount AS amount, pay.currency AS currency
          FROM payments pay
          LEFT JOIN v_payments_clean vc ON vc.payment_id = pay.payment_id
          WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = pay.order_id)
            AND vc.order_date BETWEEN ? AND ?
          ORDER BY pay.payment_id DESC
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
    if (type === "parent_mismatch") {
      return {
        sql: `
          SELECT api.payment_id AS id, date(api.create_timestamp, 'unixepoch') AS date,
            CASE WHEN api.amount_gross_divisor > 0
              THEN api.amount_gross * 1.0 / api.amount_gross_divisor END AS amount,
            api.amount_gross_currency AS currency,
            ('API parent ' || api.receipt_id || ' vs CSV parent ' || csv.order_id) AS detail
          FROM etsy_api_payments api
          JOIN payments csv ON csv.payment_id = api.payment_id
          WHERE csv.order_id <> api.receipt_id
            AND date(api.create_timestamp, 'unixepoch') BETWEEN ? AND ?
          ORDER BY api.payment_id
          LIMIT ? OFFSET ?
        `,
        params: [range.min, range.max, fetchLimit, offset],
      };
    }
  }

  return null;
}

// Doc risk: "büyük export response" -- exports are capped regardless of what
// the caller asks for, paging internally in MAX_ISSUE_PAGE_SIZE chunks.
export const MAX_EXPORT_ROWS = 2000;

function csvEscape(value: string): string {
  // Spreadsheet applications can execute cells beginning with formula
  // sigils. These values currently come from Etsy IDs/currencies and
  // server-built detail strings, but neutralizing them here keeps the export
  // safe if a future issue type includes source-controlled text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** No buyer PII column exists on IssueRecord in the first place (see the
 * allowlist note above), so this export can never leak it by construction. */
export function toCsv(items: IssueRecord[]): string {
  const header = ["id", "date", "amount", "currency", "detail"];
  const lines = [header.join(",")];
  for (const item of items) {
    lines.push(
      [item.id, item.date ?? "", item.amount === null ? "" : String(item.amount), item.currency ?? "", item.detail ?? ""]
        .map((value) => csvEscape(String(value)))
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function loadIssuePage(
  db: D1DatabaseWithAll,
  entity: IssueEntity,
  type: IssueType,
  range: DateRange,
  limit: number,
  offset: number,
): Promise<IssuesPage> {
  const query = buildQuery(entity, type, range, limit, offset);
  if (!query) {
    return { entity, type, items: [], limit, offset, hasMore: false };
  }

  const result = await db.prepare(query.sql).bind(...query.params).all<IssueRecord>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    entity,
    type,
    items: items.map((row) => ({
      id: String(row.id),
      date: row.date ?? null,
      amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
      currency: row.currency ?? null,
      ...(row.detail ? { detail: row.detail } : {}),
    })),
    limit,
    offset,
    hasMore,
  };
}

/** Pages internally up to MAX_EXPORT_ROWS -- export uses the exact same
 * buildQuery/loadIssuePage path as the on-screen list, so it is guaranteed
 * to return the same rows for the same filters (plan §9.8 / §8.2 acceptance
 * criterion). */
export async function loadAllIssuesForExport(
  db: D1DatabaseWithAll,
  entity: IssueEntity,
  type: IssueType,
  range: DateRange,
): Promise<IssueRecord[]> {
  const items: IssueRecord[] = [];
  let offset = 0;
  while (items.length < MAX_EXPORT_ROWS) {
    const page = await loadIssuePage(db, entity, type, range, MAX_ISSUE_PAGE_SIZE, offset);
    items.push(...page.items);
    if (!page.hasMore) break;
    offset += MAX_ISSUE_PAGE_SIZE;
  }
  return items.slice(0, MAX_EXPORT_ROWS);
}

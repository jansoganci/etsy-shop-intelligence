import { queryAll, queryFirst, type D1Database } from "../reports/_summary";

type Context = {
  request: Request;
  env: { DB: D1Database };
};

type MonthRow = {
  month: string | null;
};

type WatermarkRow = {
  cursor_value: string | null;
  last_success_at: string | null;
};

type PeriodRow = {
  from_ts: number;
  to_ts: number;
  status: string;
  etsy_receipt_count: number | null;
  persisted_receipt_count: number | null;
  payment_parents_selected: number | null;
  payment_parents_checked: number | null;
  ledger_complete: number;
  first_synced_at: string | null;
  last_refreshed_at: string | null;
};

const CSV_SOURCE_QUERIES = {
  orders: `
    SELECT DISTINCT substr(sale_date, 1, 7) AS month
    FROM v_orders_clean
    WHERE sale_date IS NOT NULL
  `,
  orderItems: `
    SELECT DISTINCT substr(sale_date, 1, 7) AS month
    FROM v_order_items_clean
    WHERE sale_date IS NOT NULL
  `,
  payments: `
    SELECT DISTINCT substr(order_date, 1, 7) AS month
    FROM v_payments_clean
    WHERE order_date IS NOT NULL
  `,
} as const;

function parseLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = raw === null ? 24 : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 24;
  }
  return Math.min(Math.floor(parsed), 100);
}

function parseCursorValue(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDateFromUnixSeconds(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function periodDates(fromTs: number, toExclusiveTs: number): { fromDate: string; toDate: string } {
  return {
    fromDate: utcDateFromUnixSeconds(fromTs),
    toDate: utcDateFromUnixSeconds(toExclusiveTs - 1),
  };
}

async function resolveShopId(db: D1Database): Promise<string | null> {
  const connected = await queryFirst<{ shop_id: string }>(
    db,
    "SELECT shop_id FROM etsy_connections WHERE status = 'connected' LIMIT 1",
  );
  if (connected?.shop_id) {
    return connected.shop_id;
  }

  const cursorShop = await queryFirst<{ shop_id: string }>(
    db,
    `
      SELECT shop_id
      FROM etsy_sync_cursors
      WHERE resource = 'sales' AND cursor_key = 'last_modified'
      LIMIT 1
    `,
  );
  return cursorShop?.shop_id ?? null;
}

async function loadWatermark(
  db: D1Database,
  shopId: string | null,
): Promise<{ cursorValue: number | null; lastSuccessAt: string | null }> {
  if (!shopId) {
    return { cursorValue: null, lastSuccessAt: null };
  }

  const row = await queryFirst<WatermarkRow>(
    db,
    `
      SELECT cursor_value, last_success_at
      FROM etsy_sync_cursors
      WHERE shop_id = ? AND resource = 'sales' AND cursor_key = 'last_modified'
      LIMIT 1
    `,
    [shopId],
  );

  return {
    cursorValue: parseCursorValue(row?.cursor_value ?? null),
    lastSuccessAt: row?.last_success_at ?? null,
  };
}

async function loadPeriods(db: D1Database, shopId: string | null, limit: number) {
  if (!shopId) {
    return [];
  }

  const rows = await queryAll<PeriodRow>(
    db,
    `
      SELECT
        from_ts,
        to_ts,
        status,
        etsy_receipt_count,
        persisted_receipt_count,
        payment_parents_selected,
        payment_parents_checked,
        ledger_complete,
        first_synced_at,
        last_refreshed_at
      FROM etsy_commerce_period_coverage
      WHERE shop_id = ?
      ORDER BY from_ts DESC
      LIMIT ?
    `,
    [shopId, limit],
  );

  return rows.map((row) => {
    const dates = periodDates(row.from_ts, row.to_ts);
    return {
      fromTs: row.from_ts,
      toExclusiveTs: row.to_ts,
      fromDate: dates.fromDate,
      toDate: dates.toDate,
      status: row.status,
      etsyReceiptCount: row.etsy_receipt_count,
      persistedReceiptCount: row.persisted_receipt_count,
      paymentParentsSelected: row.payment_parents_selected,
      paymentParentsChecked: row.payment_parents_checked,
      ledgerComplete: row.ledger_complete === 1,
      firstSyncedAt: row.first_synced_at,
      lastRefreshedAt: row.last_refreshed_at,
    };
  });
}

async function loadCsvPresence(db: D1Database) {
  const [orderRows, orderItemRows, paymentRows] = await Promise.all([
    queryAll<MonthRow>(db, CSV_SOURCE_QUERIES.orders),
    queryAll<MonthRow>(db, CSV_SOURCE_QUERIES.orderItems),
    queryAll<MonthRow>(db, CSV_SOURCE_QUERIES.payments),
  ]);

  const orderMonths = new Set(
    orderRows.map((row) => row.month).filter((month): month is string => Boolean(month)),
  );
  const orderItemMonths = new Set(
    orderItemRows.map((row) => row.month).filter((month): month is string => Boolean(month)),
  );
  const paymentMonths = new Set(
    paymentRows.map((row) => row.month).filter((month): month is string => Boolean(month)),
  );

  const allMonths = new Set<string>([
    ...orderMonths,
    ...orderItemMonths,
    ...paymentMonths,
  ]);

  return Array.from(allMonths)
    .sort()
    .map((month) => ({
      month,
      orders: orderMonths.has(month),
      orderItems: orderItemMonths.has(month),
      payments: paymentMonths.has(month),
    }));
}

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const limit = parseLimit(context.request);
    const shopId = await resolveShopId(context.env.DB);
    const [watermark, periods, csvPresence] = await Promise.all([
      loadWatermark(context.env.DB, shopId),
      loadPeriods(context.env.DB, shopId, limit),
      loadCsvPresence(context.env.DB),
    ]);

    return Response.json({
      ok: true,
      watermark,
      periods,
      csvPresence,
    });
  } catch {
    return Response.json(
      { ok: false, error: "data_center_commerce_coverage_failed" },
      { status: 500 },
    );
  }
}

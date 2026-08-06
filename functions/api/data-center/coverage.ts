import { queryAll, type D1Database } from "../reports/_summary";

type Context = {
  env: { DB: D1Database };
};

type MonthRow = {
  month: string | null;
};

type SourceKey = "sold_orders" | "sold_order_items" | "direct_checkout_payments";

const SOURCE_QUERIES: Record<SourceKey, string> = {
  sold_orders: `
    SELECT DISTINCT substr(sale_date, 1, 7) AS month
    FROM v_orders_clean
    WHERE sale_date IS NOT NULL
  `,
  sold_order_items: `
    SELECT DISTINCT substr(sale_date, 1, 7) AS month
    FROM v_order_items_clean
    WHERE sale_date IS NOT NULL
  `,
  direct_checkout_payments: `
    SELECT DISTINCT substr(order_date, 1, 7) AS month
    FROM v_payments_clean
    WHERE order_date IS NOT NULL
  `,
};

function previousCompletedMonth(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

function listMonths(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
  const end = new Date(Date.UTC(toYear, toMonth - 1, 1));
  const months: string[] = [];

  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const lastCompletedMonth = previousCompletedMonth(new Date());
    const entries = await Promise.all(
      (Object.keys(SOURCE_QUERIES) as SourceKey[]).map(async (source) => {
        const rows = await queryAll<MonthRow>(context.env.DB, SOURCE_QUERIES[source]);
        const presentMonths = new Set(
          rows.map((row) => row.month).filter((month): month is string => Boolean(month)),
        );
        const sortedMonths = Array.from(presentMonths).sort();
        const firstMonth = sortedMonths[0] ?? null;
        const lastMonth = sortedMonths.at(-1) ?? null;
        const expectedMonths = firstMonth
          ? listMonths(firstMonth, lastCompletedMonth > (lastMonth ?? "") ? lastCompletedMonth : lastMonth!)
          : [];
        const missingMonths = expectedMonths.filter(
          (month) => month <= lastCompletedMonth && !presentMonths.has(month),
        );

        return [source, { firstMonth, lastMonth, missingMonths }] as const;
      }),
    );

    return Response.json({
      ok: true,
      lastCompletedMonth,
      sources: Object.fromEntries(entries),
    });
  } catch {
    return Response.json(
      { ok: false, error: "data_center_coverage_failed" },
      { status: 500 },
    );
  }
}

import { loadMonthlyStats, type D1Database } from "./_db";

type CoverageRow = {
  first_month: string | null;
};

function previousMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const date = new Date(Date.UTC(year, month - 2, 1));
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

export async function onRequestGet(context: {
  env: { DB: D1Database };
}): Promise<Response> {
  try {
    const [stats, coverage] = await Promise.all([
      loadMonthlyStats(context.env.DB),
      context.env.DB
        .prepare(
          `
            SELECT MIN(substr(sale_date, 1, 7)) AS first_month
            FROM v_orders_canonical
            WHERE sale_date IS NOT NULL
          `,
        )
        .first<CoverageRow>(),
    ]);

    const lastCompletedMonth = previousMonth(new Date());
    const firstMonth = coverage?.first_month ?? stats.at(-1)?.month ?? null;
    const expectedMonths = firstMonth ? listMonths(firstMonth, lastCompletedMonth) : [];
    const savedMonths = new Set(stats.map((record) => record.month));
    const missingMonths = expectedMonths.filter((month) => !savedMonths.has(month));

    return Response.json({
      ok: true,
      stats,
      summary: {
        count: stats.length,
        latestMonth: stats[0]?.month ?? null,
        firstExpectedMonth: firstMonth,
        lastExpectedMonth: lastCompletedMonth,
        missingMonths,
      },
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "etsy_stats_load_failed",
        message: "Monthly Etsy Stats could not be loaded.",
      },
      { status: 500 },
    );
  }
}

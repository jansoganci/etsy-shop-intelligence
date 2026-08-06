import {
  TRAFFIC_SOURCE_KEYS,
  type MonthlyStatsInput,
  type MonthlyTrafficSourceInput,
  type TrafficSourceKey,
} from "./_validation";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface D1Database {
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
  prepare(query: string): D1PreparedStatement;
}

type MonthlyStatsRow = {
  month: string;
  currency: string;
  visits: number;
  orders: number;
  conversion_rate: number;
  revenue: number;
  item_favorites: number;
  shop_follows: number;
  reviews: number;
  repeat_buyers: number;
  cities_reached: number;
  abandoned_carts: number;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

type TrafficSourceRow = {
  month: string;
  source_key: string;
  visits: number;
  share_percent: number | null;
};

export type MonthlyStatsRecord = MonthlyStatsInput & {
  source: string;
  createdAt: string;
  updatedAt: string;
};

function emptyTrafficSources(): Record<TrafficSourceKey, MonthlyTrafficSourceInput> {
  return Object.fromEntries(
    TRAFFIC_SOURCE_KEYS.map((key) => [key, { visits: 0, sharePercent: null }]),
  ) as Record<TrafficSourceKey, MonthlyTrafficSourceInput>;
}

export function mapMonthlyStatsRows(
  rows: MonthlyStatsRow[],
  trafficRows: TrafficSourceRow[],
): MonthlyStatsRecord[] {
  const sourcesByMonth = new Map<
    string,
    Record<TrafficSourceKey, MonthlyTrafficSourceInput>
  >();

  for (const row of trafficRows) {
    if (!TRAFFIC_SOURCE_KEYS.includes(row.source_key as TrafficSourceKey)) {
      continue;
    }
    const sources = sourcesByMonth.get(row.month) ?? emptyTrafficSources();
    sources[row.source_key as TrafficSourceKey] = {
      visits: Number(row.visits) || 0,
      sharePercent: row.share_percent === null ? null : Number(row.share_percent),
    };
    sourcesByMonth.set(row.month, sources);
  }

  return rows.map((row) => ({
    month: row.month,
    currency: "USD",
    visits: Number(row.visits) || 0,
    orders: Number(row.orders) || 0,
    conversionRate: Number(row.conversion_rate) || 0,
    revenue: Number(row.revenue) || 0,
    itemFavorites: Number(row.item_favorites) || 0,
    shopFollows: Number(row.shop_follows) || 0,
    reviews: Number(row.reviews) || 0,
    repeatBuyers: Number(row.repeat_buyers) || 0,
    citiesReached: Number(row.cities_reached) || 0,
    abandonedCarts: Number(row.abandoned_carts) || 0,
    trafficSources: sourcesByMonth.get(row.month) ?? emptyTrafficSources(),
    notes: row.notes,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function loadMonthlyStats(
  db: D1Database,
  month?: string,
): Promise<MonthlyStatsRecord[]> {
  const monthClause = month ? "WHERE month = ?" : "";
  const statsStatement = db.prepare(
    `
      SELECT
        month,
        currency,
        visits,
        orders,
        conversion_rate,
        revenue,
        item_favorites,
        shop_follows,
        reviews,
        repeat_buyers,
        cities_reached,
        abandoned_carts,
        notes,
        source,
        created_at,
        updated_at
      FROM etsy_monthly_stats
      ${monthClause}
      ORDER BY month DESC
    `,
  );
  const trafficStatement = db.prepare(
    `
      SELECT month, source_key, visits, share_percent
      FROM etsy_monthly_traffic_sources
      ${monthClause}
      ORDER BY month DESC, source_key ASC
    `,
  );

  const [statsResult, trafficResult] = await Promise.all([
    (month ? statsStatement.bind(month) : statsStatement).all<MonthlyStatsRow>(),
    (month ? trafficStatement.bind(month) : trafficStatement).all<TrafficSourceRow>(),
  ]);

  return mapMonthlyStatsRows(
    statsResult.results ?? [],
    trafficResult.results ?? [],
  );
}

export async function saveMonthlyStats(
  db: D1Database,
  stats: MonthlyStatsInput,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `
          INSERT INTO etsy_monthly_stats (
            month,
            currency,
            visits,
            orders,
            conversion_rate,
            revenue,
            item_favorites,
            shop_follows,
            reviews,
            repeat_buyers,
            cities_reached,
            abandoned_carts,
            notes,
            source,
            created_at,
            updated_at
          )
          VALUES (?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_json', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(month) DO UPDATE SET
            currency = 'USD',
            visits = excluded.visits,
            orders = excluded.orders,
            conversion_rate = excluded.conversion_rate,
            revenue = excluded.revenue,
            item_favorites = excluded.item_favorites,
            shop_follows = excluded.shop_follows,
            reviews = excluded.reviews,
            repeat_buyers = excluded.repeat_buyers,
            cities_reached = excluded.cities_reached,
            abandoned_carts = excluded.abandoned_carts,
            notes = excluded.notes,
            source = excluded.source,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .bind(
        stats.month,
        stats.visits,
        stats.orders,
        stats.conversionRate,
        stats.revenue,
        stats.itemFavorites,
        stats.shopFollows,
        stats.reviews,
        stats.repeatBuyers,
        stats.citiesReached,
        stats.abandonedCarts,
        stats.notes,
      ),
    db
      .prepare("DELETE FROM etsy_monthly_traffic_sources WHERE month = ?")
      .bind(stats.month),
  ];

  for (const sourceKey of TRAFFIC_SOURCE_KEYS) {
    const source = stats.trafficSources[sourceKey];
    statements.push(
      db
        .prepare(
          `
            INSERT INTO etsy_monthly_traffic_sources (
              month,
              source_key,
              visits,
              share_percent,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
        )
        .bind(stats.month, sourceKey, source.visits, source.sharePercent),
    );
  }

  await db.batch(statements);
}

export async function deleteMonthlyStats(db: D1Database, month: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM etsy_monthly_traffic_sources WHERE month = ?").bind(month),
    db.prepare("DELETE FROM etsy_monthly_stats WHERE month = ?").bind(month),
  ]);
}

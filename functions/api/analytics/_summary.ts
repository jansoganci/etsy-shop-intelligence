export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type SummaryRange = "30d" | "90d" | "180d" | "365d";

export const SUMMARY_RANGES: SummaryRange[] = ["30d", "90d", "180d", "365d"];

const RANGE_DAY_COUNT: Record<SummaryRange, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

const DEFAULT_BREAKDOWN_LIMIT = 25;

type SyncRunRow = {
  syncRunId: number;
  propertyId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  syncedAt: string | null;
};

type KpiRow = {
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
  eventCount: number | null;
};

type DailyTrendRow = {
  date: string;
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
  eventCount: number | null;
};

type TrafficSourceRow = {
  channelGroup: string;
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
};

type TopPageRow = {
  pagePath: string;
  pageTitle: string | null;
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
};

type CountryRow = {
  country: string;
  activeUsers: number | null;
  sessions: number | null;
};

type DeviceRow = {
  deviceCategory: string;
  activeUsers: number | null;
  sessions: number | null;
};

type EventRow = {
  eventName: string;
  eventCount: number | null;
  activeUsers: number | null;
};

export type GaSummaryLastSync = {
  syncRunId: number;
  syncedAt: string | null;
  status: string;
  dateFrom: string;
  dateTo: string;
};

export type GaSummaryData = {
  range: SummaryRange;
  lastSync: GaSummaryLastSync;
  kpis: {
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
    eventCount: number;
  };
  dailyTrend: Array<{
    date: string;
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
    eventCount: number;
  }>;
  trafficSources: Array<{
    channelGroup: string;
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
  }>;
  topPages: Array<{
    pagePath: string;
    pageTitle: string | null;
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
  }>;
  countries: Array<{
    country: string;
    activeUsers: number;
    sessions: number;
  }>;
  devices: Array<{
    deviceCategory: string;
    activeUsers: number;
    sessions: number;
  }>;
  events: Array<{
    eventName: string;
    eventCount: number;
    activeUsers: number;
  }>;
  warnings: string[];
  source: "google_analytics";
};

export type LoadGaSummaryOptions = {
  /** Max rows for top pages / countries / events. Defaults to 25 (UI). AI uses 10. */
  breakdownLimit?: number;
};

export function isSummaryRange(value: unknown): value is SummaryRange {
  return typeof value === "string" && (SUMMARY_RANGES as string[]).includes(value);
}

function toNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return value;
}

/**
 * Load GA summary from D1.
 * Daily KPIs/trend use `range` (last N days of ga_daily_metrics).
 * Channel/page/country/device/event breakdowns use the last completed sync window.
 * Returns null when no completed sync exists.
 */
export async function loadGaSummary(
  db: D1Database,
  range: SummaryRange = "90d",
  options: LoadGaSummaryOptions = {},
): Promise<GaSummaryData | null> {
  const breakdownLimit = options.breakdownLimit ?? DEFAULT_BREAKDOWN_LIMIT;
  const requestedDayCount = RANGE_DAY_COUNT[range];

  const lastSync = await db
    .prepare(
      `
        SELECT
          id AS syncRunId,
          property_id AS propertyId,
          date_from AS dateFrom,
          date_to AS dateTo,
          status,
          COALESCE(completed_at, started_at) AS syncedAt
        FROM ga_sync_runs
        WHERE status = 'completed'
        ORDER BY COALESCE(completed_at, started_at) DESC, id DESC
        LIMIT 1
      `,
    )
    .first<SyncRunRow>();

  if (!lastSync) {
    return null;
  }

  const latestDailyDatesResult = await db
    .prepare(
      `
        SELECT date
        FROM ga_daily_metrics
        WHERE property_id = ?
        ORDER BY date DESC
        LIMIT ?
      `,
    )
    .bind(lastSync.propertyId, requestedDayCount)
    .all<{ date: string }>();

  const latestDates = (latestDailyDatesResult.results ?? []).map((row) => row.date);

  let kpis: KpiRow | null = null;
  let dailyTrendRows: DailyTrendRow[] = [];

  if (latestDates.length > 0) {
    kpis = await db
      .prepare(
        `
          SELECT
            COALESCE(SUM(active_users), 0) AS activeUsers,
            COALESCE(SUM(sessions), 0) AS sessions,
            COALESCE(SUM(screen_page_views), 0) AS screenPageViews,
            COALESCE(SUM(event_count), 0) AS eventCount
          FROM ga_daily_metrics
          WHERE property_id = ?
            AND date IN (
              SELECT date
              FROM ga_daily_metrics
              WHERE property_id = ?
              ORDER BY date DESC
              LIMIT ?
            )
        `,
      )
      .bind(lastSync.propertyId, lastSync.propertyId, requestedDayCount)
      .first<KpiRow>();

    const dailyTrendResult = await db
      .prepare(
        `
          SELECT
            date,
            active_users AS activeUsers,
            sessions,
            screen_page_views AS screenPageViews,
            event_count AS eventCount
          FROM ga_daily_metrics
          WHERE property_id = ?
            AND date IN (
              SELECT date
              FROM ga_daily_metrics
              WHERE property_id = ?
              ORDER BY date DESC
              LIMIT ?
            )
          ORDER BY date ASC
        `,
      )
      .bind(lastSync.propertyId, lastSync.propertyId, requestedDayCount)
      .all<DailyTrendRow>();

    dailyTrendRows = dailyTrendResult.results ?? [];
  }

  const trafficSourcesResult = await db
    .prepare(
      `
        SELECT
          channel_group AS channelGroup,
          active_users AS activeUsers,
          sessions,
          screen_page_views AS screenPageViews
        FROM ga_traffic_sources
        WHERE property_id = ?
          AND date_from = ?
          AND date_to = ?
        ORDER BY sessions DESC, channel_group ASC
      `,
    )
    .bind(lastSync.propertyId, lastSync.dateFrom, lastSync.dateTo)
    .all<TrafficSourceRow>();

  const topPagesResult = await db
    .prepare(
      `
        SELECT
          page_path AS pagePath,
          page_title AS pageTitle,
          active_users AS activeUsers,
          sessions,
          screen_page_views AS screenPageViews
        FROM ga_top_pages
        WHERE property_id = ?
          AND date_from = ?
          AND date_to = ?
        ORDER BY screen_page_views DESC, page_path ASC
        LIMIT ?
      `,
    )
    .bind(lastSync.propertyId, lastSync.dateFrom, lastSync.dateTo, breakdownLimit)
    .all<TopPageRow>();

  const countriesResult = await db
    .prepare(
      `
        SELECT
          country,
          active_users AS activeUsers,
          sessions
        FROM ga_countries
        WHERE property_id = ?
          AND date_from = ?
          AND date_to = ?
        ORDER BY sessions DESC, country ASC
        LIMIT ?
      `,
    )
    .bind(lastSync.propertyId, lastSync.dateFrom, lastSync.dateTo, breakdownLimit)
    .all<CountryRow>();

  const devicesResult = await db
    .prepare(
      `
        SELECT
          device_category AS deviceCategory,
          active_users AS activeUsers,
          sessions
        FROM ga_devices
        WHERE property_id = ?
          AND date_from = ?
          AND date_to = ?
        ORDER BY sessions DESC, device_category ASC
      `,
    )
    .bind(lastSync.propertyId, lastSync.dateFrom, lastSync.dateTo)
    .all<DeviceRow>();

  const eventsResult = await db
    .prepare(
      `
        SELECT
          event_name AS eventName,
          event_count AS eventCount,
          active_users AS activeUsers
        FROM ga_events
        WHERE property_id = ?
          AND date_from = ?
          AND date_to = ?
        ORDER BY event_count DESC, event_name ASC
        LIMIT ?
      `,
    )
    .bind(lastSync.propertyId, lastSync.dateFrom, lastSync.dateTo, breakdownLimit)
    .all<EventRow>();

  const warnings = [
    `Channel/page/country/device/event breakdowns cover the last sync window (${lastSync.dateFrom} → ${lastSync.dateTo}), not the KPI range (${range}).`,
  ];

  if (latestDates.length === 0) {
    warnings.push("No daily metrics rows found for this property; KPIs and dailyTrend are empty.");
  }

  return {
    range,
    lastSync: {
      syncRunId: lastSync.syncRunId,
      syncedAt: lastSync.syncedAt,
      status: lastSync.status,
      dateFrom: lastSync.dateFrom,
      dateTo: lastSync.dateTo,
    },
    kpis: {
      activeUsers: toNumber(kpis?.activeUsers),
      sessions: toNumber(kpis?.sessions),
      screenPageViews: toNumber(kpis?.screenPageViews),
      eventCount: toNumber(kpis?.eventCount),
    },
    dailyTrend: dailyTrendRows.map((row) => ({
      date: row.date,
      activeUsers: toNumber(row.activeUsers),
      sessions: toNumber(row.sessions),
      screenPageViews: toNumber(row.screenPageViews),
      eventCount: toNumber(row.eventCount),
    })),
    trafficSources: (trafficSourcesResult.results ?? []).map((row) => ({
      channelGroup: row.channelGroup,
      activeUsers: toNumber(row.activeUsers),
      sessions: toNumber(row.sessions),
      screenPageViews: toNumber(row.screenPageViews),
    })),
    topPages: (topPagesResult.results ?? []).map((row) => ({
      pagePath: row.pagePath,
      pageTitle: row.pageTitle,
      activeUsers: toNumber(row.activeUsers),
      sessions: toNumber(row.sessions),
      screenPageViews: toNumber(row.screenPageViews),
    })),
    countries: (countriesResult.results ?? []).map((row) => ({
      country: row.country,
      activeUsers: toNumber(row.activeUsers),
      sessions: toNumber(row.sessions),
    })),
    devices: (devicesResult.results ?? []).map((row) => ({
      deviceCategory: row.deviceCategory,
      activeUsers: toNumber(row.activeUsers),
      sessions: toNumber(row.sessions),
    })),
    events: (eventsResult.results ?? []).map((row) => ({
      eventName: row.eventName,
      eventCount: toNumber(row.eventCount),
      activeUsers: toNumber(row.activeUsers),
    })),
    warnings,
    source: "google_analytics",
  };
}

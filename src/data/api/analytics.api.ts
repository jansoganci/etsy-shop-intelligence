export type GoogleAnalyticsSummaryApiResponse = {
  ok: true;
  lastSync: {
    syncRunId: number;
    syncedAt: string;
    status: string;
    dateFrom: string;
    dateTo: string;
  } | null;
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
};

export type GoogleAnalyticsSummaryRange = "30d" | "90d" | "180d" | "365d";

export type GoogleAnalyticsSyncApiResponse = {
  ok: true;
  syncRunId: number;
  propertyId?: string;
  dateFrom: string;
  dateTo: string;
  report: string;
  results: {
    dailyMetrics: number;
    trafficSources: number;
    topPages: number;
    countries: number;
    devices: number;
    events: number;
  };
};

type GoogleAnalyticsApiFailure = {
  ok: false;
  error: string;
  step?: string;
};

async function parseJsonResponse<TSuccess>(
  response: Response,
  invalidResponseMessage: string,
): Promise<TSuccess | GoogleAnalyticsApiFailure> {
  try {
    return (await response.json()) as TSuccess | GoogleAnalyticsApiFailure;
  } catch {
    throw new Error(invalidResponseMessage);
  }
}

export async function fetchGoogleAnalyticsSummary(
  range: GoogleAnalyticsSummaryRange = "90d",
): Promise<GoogleAnalyticsSummaryApiResponse> {
  let response: Response;

  try {
    response = await fetch(`/api/analytics/summary?range=${encodeURIComponent(range)}`);
  } catch {
    throw new Error("Network error while loading Google Analytics summary.");
  }

  const data = await parseJsonResponse<GoogleAnalyticsSummaryApiResponse>(
    response,
    "Google Analytics summary API returned an invalid response.",
  );

  if (!response.ok || !data.ok) {
    throw new Error("Google Analytics summary is unavailable right now. Try again in a moment.");
  }

  return data;
}

function describeSyncError(error: string): string {
  if (error === "missing_google_analytics_env") {
    return "Google Analytics is not connected yet. Ask whoever manages this site to add the Google Analytics credentials.";
  }

  return "Failed to sync Google Analytics. Try again in a moment.";
}

export async function syncGoogleAnalytics(): Promise<GoogleAnalyticsSyncApiResponse> {
  let response: Response;

  try {
    response = await fetch("/api/analytics/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        report: "all",
      }),
    });
  } catch {
    throw new Error("Network error while syncing Google Analytics.");
  }

  const data = await parseJsonResponse<GoogleAnalyticsSyncApiResponse>(
    response,
    "Google Analytics sync API returned an invalid response.",
  );

  if (!response.ok || !data.ok) {
    throw new Error(data.ok ? "Failed to sync Google Analytics." : describeSyncError(data.error));
  }

  return data;
}

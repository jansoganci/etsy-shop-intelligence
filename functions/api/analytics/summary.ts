import {
  isSummaryRange,
  loadGaSummary,
  type D1Database,
  type SummaryRange,
} from "./_summary";

interface Env {
  DB?: D1Database;
}

function emptyResponse() {
  return {
    ok: true as const,
    lastSync: null,
    kpis: {
      activeUsers: 0,
      sessions: 0,
      screenPageViews: 0,
      eventCount: 0,
    },
    dailyTrend: [] as Array<{
      date: string;
      activeUsers: number;
      sessions: number;
      screenPageViews: number;
      eventCount: number;
    }>,
    trafficSources: [] as Array<{
      channelGroup: string;
      activeUsers: number;
      sessions: number;
      screenPageViews: number;
    }>,
    topPages: [] as Array<{
      pagePath: string;
      pageTitle: string | null;
      activeUsers: number;
      sessions: number;
      screenPageViews: number;
    }>,
    countries: [] as Array<{
      country: string;
      activeUsers: number;
      sessions: number;
    }>,
    devices: [] as Array<{
      deviceCategory: string;
      activeUsers: number;
      sessions: number;
    }>,
    events: [] as Array<{
      eventName: string;
      eventCount: number;
      activeUsers: number;
    }>,
  };
}

function getRequestedRange(request: Request): SummaryRange {
  const url = new URL(request.url);
  const range = url.searchParams.get("range");

  if (!range) {
    return "90d";
  }

  if (isSummaryRange(range)) {
    return range;
  }

  throw new Error("invalid_summary_range");
}

export async function onRequestGet(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  if (!context.env.DB) {
    return Response.json(
      {
        ok: false,
        error: "missing_db_binding",
      },
      { status: 500 },
    );
  }

  let requestedRange: SummaryRange;

  try {
    requestedRange = getRequestedRange(context.request);
  } catch {
    return Response.json(
      {
        ok: false,
        error: "invalid_summary_range",
      },
      { status: 400 },
    );
  }

  try {
    const summary = await loadGaSummary(context.env.DB, requestedRange, {
      breakdownLimit: 25,
    });

    if (!summary) {
      return Response.json(emptyResponse());
    }

    return Response.json({
      ok: true,
      lastSync: summary.lastSync,
      kpis: summary.kpis,
      dailyTrend: summary.dailyTrend,
      trafficSources: summary.trafficSources,
      topPages: summary.topPages,
      countries: summary.countries,
      devices: summary.devices,
      events: summary.events,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "google_analytics_summary_failed";
    const hostname = new URL(context.request.url).hostname;
    const includeDetail =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";

    return Response.json(
      {
        ok: false,
        error: "google_analytics_summary_failed",
        ...(includeDetail ? { detail: message, range: requestedRange } : {}),
      },
      { status: 500 },
    );
  }
}

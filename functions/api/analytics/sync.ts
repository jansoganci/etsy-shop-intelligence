interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1Database {
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  GA_PROPERTY_ID?: string;
  GA_CLIENT_EMAIL?: string;
  GA_PRIVATE_KEY?: string;
}

type RequestBody = {
  dateFrom?: string;
  dateTo?: string;
  report?: SyncReportName;
};

type DebugMode = "ping" | "env" | "auth";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleAnalyticsReportResponse = {
  rows?: GoogleAnalyticsReportRow[];
  error?: {
    message?: string;
  };
};

type GoogleAnalyticsReportRow = {
  dimensionValues?: Array<{
    value?: string;
  }>;
  metricValues?: Array<{
    value?: string;
  }>;
};

type ReportRequest = {
  dimensions?: string[];
  metrics: string[];
  limit?: number;
  metricOrderBy?: string;
};

type SyncResults = {
  dailyMetrics: number;
  trafficSources: number;
  topPages: number;
  countries: number;
  devices: number;
  events: number;
};

type SyncReportName =
  | "daily"
  | "trafficSources"
  | "topPages"
  | "countries"
  | "devices"
  | "events"
  | "all";

type ReportExecutionResult = {
  rowCount: number;
  fetchReportMs: number;
  d1WriteMs: number;
};

type SyncTimings = {
  authMs: number;
  fetchReportMs: number;
  d1WriteMs: number;
  totalMs: number;
};

type DebugStep = {
  step: string;
  durationMs: number;
  status: "completed" | "failed";
  detail?: string;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_ANALYTICS_REPORT_URL = "https://analyticsdata.googleapis.com/v1beta";
const VALID_DEBUG_MODES: DebugMode[] = ["ping", "env", "auth"];
const VALID_REPORTS: SyncReportName[] = [
  "daily",
  "trafficSources",
  "topPages",
  "countries",
  "devices",
  "events",
  "all",
];

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function getMissingEnv(env: Env): string[] {
  const required: Array<keyof Env> = [
    "GA_PROPERTY_ID",
    "GA_CLIENT_EMAIL",
    "GA_PRIVATE_KEY",
  ];

  return required.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function createSignedJwt(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: GOOGLE_ANALYTICS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const assertion = await createSignedJwt(clientEmail, privateKeyPem);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const tokenResult = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !tokenResult.access_token) {
    throw new Error(
      tokenResult.error_description ||
        tokenResult.error ||
        "google_token_request_failed",
    );
  }

  return tokenResult.access_token;
}

function toMetricNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGaDate(value: string | undefined): string {
  if (!value) {
    return "";
  }

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  return value;
}

async function parseRequestBody(request: Request): Promise<RequestBody> {
  const text = await request.text();

  if (text.trim().length === 0) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid_json_body");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_json_body");
  }

  const body = parsed as RequestBody;

  if (
    ("dateFrom" in body && typeof body.dateFrom !== "string") ||
    ("dateTo" in body && typeof body.dateTo !== "string") ||
    ("report" in body && typeof body.report !== "string")
  ) {
    throw new Error("invalid_date_range");
  }

  return body;
}

function getRequestedReport(
  request: Request,
  body: RequestBody,
): SyncReportName {
  const url = new URL(request.url);
  const queryReport = url.searchParams.get("report");
  const requestedReport = queryReport ?? body.report ?? "daily";

  if (
    typeof requestedReport !== "string" ||
    !VALID_REPORTS.includes(requestedReport as SyncReportName)
  ) {
    throw new Error("invalid_report");
  }

  return requestedReport as SyncReportName;
}

function createEmptyResults(): SyncResults {
  return {
    dailyMetrics: 0,
    trafficSources: 0,
    topPages: 0,
    countries: 0,
    devices: 0,
    events: 0,
  };
}

function createEmptyTimings(): SyncTimings {
  return {
    authMs: 0,
    fetchReportMs: 0,
    d1WriteMs: 0,
    totalMs: 0,
  };
}

function nowMs(): number {
  return Date.now();
}

function getDebugMode(request: Request): DebugMode | null {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug");

  if (!debug) {
    return null;
  }

  if (VALID_DEBUG_MODES.includes(debug as DebugMode)) {
    return debug as DebugMode;
  }

  throw new Error("invalid_debug_mode");
}

async function createSyncRun(
  db: D1Database,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  await db
    .prepare(
      `
        INSERT INTO ga_sync_runs (
          property_id,
          date_from,
          date_to,
          status
        ) VALUES (?, ?, ?, 'running')
      `,
    )
    .bind(propertyId, dateFrom, dateTo)
    .run();

  const result = await db
    .prepare("SELECT id FROM ga_sync_runs WHERE rowid = last_insert_rowid()")
    .first<{ id: number }>();

  if (!result?.id) {
    throw new Error("ga_sync_run_creation_failed");
  }

  return result.id;
}

async function completeSyncRun(db: D1Database, syncRunId: number) {
  await db
    .prepare(
      `
        UPDATE ga_sync_runs
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = NULL
        WHERE id = ?
      `,
    )
    .bind(syncRunId)
    .run();
}

async function failSyncRun(
  db: D1Database,
  syncRunId: number,
  errorMessage: string,
) {
  await db
    .prepare(
      `
        UPDATE ga_sync_runs
        SET status = 'failed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = ?
        WHERE id = ?
      `,
    )
    .bind(errorMessage, syncRunId)
    .run();
}

async function runReport(
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  report: ReportRequest,
): Promise<GoogleAnalyticsReportRow[]> {
  const response = await fetch(
    `${GOOGLE_ANALYTICS_REPORT_URL}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [
          {
            startDate: dateFrom,
            endDate: dateTo,
          },
        ],
        dimensions: report.dimensions?.map((name) => ({ name })),
        metrics: report.metrics.map((name) => ({ name })),
        limit: report.limit ? String(report.limit) : undefined,
        orderBys: report.metricOrderBy
          ? [
              {
                metric: {
                  metricName: report.metricOrderBy,
                },
                desc: true,
              },
            ]
          : report.dimensions?.[0] === "date"
            ? [
                {
                  dimension: {
                    dimensionName: "date",
                  },
                },
              ]
            : undefined,
      }),
    },
  );

  const reportResult = (await response.json()) as GoogleAnalyticsReportResponse;

  if (!response.ok) {
    throw new Error(
      reportResult.error?.message || "google_analytics_report_failed",
    );
  }

  return reportResult.rows ?? [];
}

async function executeReport(
  fetchRows: () => Promise<GoogleAnalyticsReportRow[]>,
  writeRows: (rows: GoogleAnalyticsReportRow[]) => Promise<number>,
): Promise<ReportExecutionResult> {
  const fetchStartedAt = nowMs();
  const rows = await fetchRows();
  const fetchReportMs = nowMs() - fetchStartedAt;

  const writeStartedAt = nowMs();
  const rowCount = await writeRows(rows);
  const d1WriteMs = nowMs() - writeStartedAt;

  return {
    rowCount,
    fetchReportMs,
    d1WriteMs,
  };
}

async function replaceRangeTable(
  db: D1Database,
  table: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  statements: D1PreparedStatement[],
): Promise<number> {
  await db
    .prepare(
      `DELETE FROM ${table} WHERE property_id = ? AND date_from = ? AND date_to = ?`,
    )
    .bind(propertyId, dateFrom, dateTo)
    .run();

  if (statements.length === 0) {
    return 0;
  }

  await db.batch(statements);
  return statements.length;
}

async function syncDailyMetrics(
  db: D1Database,
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
): Promise<ReportExecutionResult> {
  return executeReport(
    () =>
      runReport(accessToken, propertyId, dateFrom, dateTo, {
        dimensions: ["date"],
        metrics: ["activeUsers", "sessions", "screenPageViews", "eventCount"],
      }),
    async (rows) => {
      const statements = rows.map((row) =>
        db
          .prepare(
            `
              INSERT OR REPLACE INTO ga_daily_metrics (
                property_id,
                date,
                active_users,
                sessions,
                screen_page_views,
                event_count,
                synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            propertyId,
            normalizeGaDate(row.dimensionValues?.[0]?.value),
            toMetricNumber(row.metricValues?.[0]?.value),
            toMetricNumber(row.metricValues?.[1]?.value),
            toMetricNumber(row.metricValues?.[2]?.value),
            toMetricNumber(row.metricValues?.[3]?.value),
            syncedAt,
          ),
      );

      if (statements.length === 0) {
        return 0;
      }

      await db.batch(statements);
      return statements.length;
    },
  );
}

async function syncTrafficSources(
  db: D1Database,
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
): Promise<ReportExecutionResult> {
  return executeReport(
    () =>
      runReport(accessToken, propertyId, dateFrom, dateTo, {
        dimensions: ["sessionDefaultChannelGroup"],
        metrics: ["activeUsers", "sessions", "screenPageViews"],
        metricOrderBy: "sessions",
      }),
    (rows) => {
      const statements = rows.map((row) =>
        db
          .prepare(
            `
              INSERT OR REPLACE INTO ga_traffic_sources (
                property_id,
                date_from,
                date_to,
                channel_group,
                active_users,
                sessions,
                screen_page_views,
                synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            propertyId,
            dateFrom,
            dateTo,
            row.dimensionValues?.[0]?.value || "(not set)",
            toMetricNumber(row.metricValues?.[0]?.value),
            toMetricNumber(row.metricValues?.[1]?.value),
            toMetricNumber(row.metricValues?.[2]?.value),
            syncedAt,
          ),
      );

      return replaceRangeTable(
        db,
        "ga_traffic_sources",
        propertyId,
        dateFrom,
        dateTo,
        statements,
      );
    },
  );
}

async function syncTopPages(
  db: D1Database,
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
): Promise<ReportExecutionResult> {
  return executeReport(
    () =>
      runReport(accessToken, propertyId, dateFrom, dateTo, {
        dimensions: ["pagePath", "pageTitle"],
        metrics: ["screenPageViews", "activeUsers", "sessions"],
        limit: 25,
        metricOrderBy: "screenPageViews",
      }),
    (rows) => {
      const statements = rows
        .filter((row) => Boolean(row.dimensionValues?.[0]?.value))
        .map((row) =>
          db
            .prepare(
              `
                INSERT OR REPLACE INTO ga_top_pages (
                  property_id,
                  date_from,
                  date_to,
                  page_path,
                  page_title,
                  active_users,
                  sessions,
                  screen_page_views,
                  synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
            )
            .bind(
              propertyId,
              dateFrom,
              dateTo,
              row.dimensionValues?.[0]?.value || "/",
              row.dimensionValues?.[1]?.value || null,
              toMetricNumber(row.metricValues?.[1]?.value),
              toMetricNumber(row.metricValues?.[2]?.value),
              toMetricNumber(row.metricValues?.[0]?.value),
              syncedAt,
            ),
        );

      return replaceRangeTable(
        db,
        "ga_top_pages",
        propertyId,
        dateFrom,
        dateTo,
        statements,
      );
    },
  );
}

async function syncCountries(
  db: D1Database,
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
): Promise<ReportExecutionResult> {
  return executeReport(
    () =>
      runReport(accessToken, propertyId, dateFrom, dateTo, {
        dimensions: ["country"],
        metrics: ["activeUsers", "sessions"],
        limit: 25,
        metricOrderBy: "sessions",
      }),
    (rows) => {
      const statements = rows.map((row) =>
        db
          .prepare(
            `
              INSERT OR REPLACE INTO ga_countries (
                property_id,
                date_from,
                date_to,
                country,
                active_users,
                sessions,
                synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            propertyId,
            dateFrom,
            dateTo,
            row.dimensionValues?.[0]?.value || "(not set)",
            toMetricNumber(row.metricValues?.[0]?.value),
            toMetricNumber(row.metricValues?.[1]?.value),
            syncedAt,
          ),
      );

      return replaceRangeTable(
        db,
        "ga_countries",
        propertyId,
        dateFrom,
        dateTo,
        statements,
      );
    },
  );
}

async function syncDevices(
  db: D1Database,
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
): Promise<ReportExecutionResult> {
  return executeReport(
    () =>
      runReport(accessToken, propertyId, dateFrom, dateTo, {
        dimensions: ["deviceCategory"],
        metrics: ["activeUsers", "sessions"],
        metricOrderBy: "sessions",
      }),
    (rows) => {
      const statements = rows.map((row) =>
        db
          .prepare(
            `
              INSERT OR REPLACE INTO ga_devices (
                property_id,
                date_from,
                date_to,
                device_category,
                active_users,
                sessions,
                synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            propertyId,
            dateFrom,
            dateTo,
            row.dimensionValues?.[0]?.value || "(not set)",
            toMetricNumber(row.metricValues?.[0]?.value),
            toMetricNumber(row.metricValues?.[1]?.value),
            syncedAt,
          ),
      );

      return replaceRangeTable(
        db,
        "ga_devices",
        propertyId,
        dateFrom,
        dateTo,
        statements,
      );
    },
  );
}

async function syncEvents(
  db: D1Database,
  accessToken: string,
  propertyId: string,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
): Promise<ReportExecutionResult> {
  return executeReport(
    () =>
      runReport(accessToken, propertyId, dateFrom, dateTo, {
        dimensions: ["eventName"],
        metrics: ["eventCount", "activeUsers"],
        limit: 25,
        metricOrderBy: "eventCount",
      }),
    (rows) => {
      const statements = rows.map((row) =>
        db
          .prepare(
            `
              INSERT OR REPLACE INTO ga_events (
                property_id,
                date_from,
                date_to,
                event_name,
                event_count,
                active_users,
                synced_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            propertyId,
            dateFrom,
            dateTo,
            row.dimensionValues?.[0]?.value || "(not set)",
            toMetricNumber(row.metricValues?.[0]?.value),
            toMetricNumber(row.metricValues?.[1]?.value),
            syncedAt,
          ),
      );

      return replaceRangeTable(
        db,
        "ga_events",
        propertyId,
        dateFrom,
        dateTo,
        statements,
      );
    },
  );
}

type ReportRunner = () => Promise<ReportExecutionResult>;

async function runSelectedReport(
  report: SyncReportName,
  runners: Record<Exclude<SyncReportName, "all">, ReportRunner>,
  results: SyncResults,
  timings: SyncTimings,
  debug: DebugStep[],
): Promise<void> {
  const reportOrder: Array<Exclude<SyncReportName, "all">> =
    report === "all"
      ? ["daily", "trafficSources", "topPages", "countries", "devices", "events"]
      : [report];

  for (const reportName of reportOrder) {
    const stepStartedAt = nowMs();

    try {
      const result = await runners[reportName]();
      const durationMs = nowMs() - stepStartedAt;

      timings.fetchReportMs += result.fetchReportMs;
      timings.d1WriteMs += result.d1WriteMs;

      if (reportName === "daily") {
        results.dailyMetrics = result.rowCount;
      } else if (reportName === "trafficSources") {
        results.trafficSources = result.rowCount;
      } else if (reportName === "topPages") {
        results.topPages = result.rowCount;
      } else if (reportName === "countries") {
        results.countries = result.rowCount;
      } else if (reportName === "devices") {
        results.devices = result.rowCount;
      } else if (reportName === "events") {
        results.events = result.rowCount;
      }

      debug.push({
        step: `report:${reportName}`,
        durationMs,
        status: "completed",
        detail: `rows=${result.rowCount}`,
      });
    } catch (error) {
      const durationMs = nowMs() - stepStartedAt;

      debug.push({
        step: `report:${reportName}`,
        durationMs,
        status: "failed",
        detail: error instanceof Error ? error.message : "report_failed",
      });

      const reportError = error instanceof Error ? error : new Error("report_failed");
      reportError.message = `${reportName}:${reportError.message}`;
      throw reportError;
    }
  }
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const requestStartedAt = nowMs();
  const timings = createEmptyTimings();
  const debug: DebugStep[] = [];

  let debugMode: DebugMode | null = null;

  try {
    debugMode = getDebugMode(context.request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid_debug_mode";
    timings.totalMs = nowMs() - requestStartedAt;

    return jsonResponse(
      {
        ok: false,
        error: message,
        step: "debug_mode",
        timings,
        debug,
      },
      400,
    );
  }

  if (debugMode === "ping") {
    try {
      return jsonResponse({
        ok: true,
        mode: "ping",
        message: "sync endpoint reachable",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "debug_ping_failed";
      timings.totalMs = nowMs() - requestStartedAt;

      return jsonResponse(
        {
          ok: false,
          mode: "ping",
          error: message,
          step: "debug_ping",
          timings,
          debug,
        },
        500,
      );
    }
  }

  if (debugMode === "env") {
    try {
      return jsonResponse({
        ok: true,
        mode: "env",
        env: {
          GA_PROPERTY_ID:
            typeof context.env.GA_PROPERTY_ID === "string" &&
            context.env.GA_PROPERTY_ID.trim().length > 0,
          GA_CLIENT_EMAIL:
            typeof context.env.GA_CLIENT_EMAIL === "string" &&
            context.env.GA_CLIENT_EMAIL.trim().length > 0,
          GA_PRIVATE_KEY:
            typeof context.env.GA_PRIVATE_KEY === "string" &&
            context.env.GA_PRIVATE_KEY.trim().length > 0,
          DB: Boolean(context.env.DB),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "debug_env_failed";
      timings.totalMs = nowMs() - requestStartedAt;

      return jsonResponse(
        {
          ok: false,
          mode: "env",
          error: message,
          step: "debug_env",
          timings,
          debug,
        },
        500,
      );
    }
  }

  if (debugMode === "auth") {
    try {
      const missingEnv = getMissingEnv(context.env);

      if (missingEnv.length > 0) {
        timings.totalMs = nowMs() - requestStartedAt;
        return jsonResponse(
          {
            ok: false,
            mode: "auth",
            error: "missing_google_analytics_env",
            missing: missingEnv,
            step: "env",
            timings,
            debug,
          },
          500,
        );
      }

      const authStartedAt = nowMs();
      await getAccessToken(
        context.env.GA_CLIENT_EMAIL!.trim(),
        context.env.GA_PRIVATE_KEY!,
      );
      timings.authMs = nowMs() - authStartedAt;
      timings.totalMs = nowMs() - requestStartedAt;

      return jsonResponse({
        ok: true,
        mode: "auth",
        authMs: timings.authMs,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "debug_auth_failed";
      timings.totalMs = nowMs() - requestStartedAt;

      return jsonResponse(
        {
          ok: false,
          mode: "auth",
          error: message,
          step: "auth",
          timings,
          debug,
        },
        500,
      );
    }
  }

  const missingEnv = getMissingEnv(context.env);

  if (missingEnv.length > 0) {
    timings.totalMs = nowMs() - requestStartedAt;
    return jsonResponse(
      {
        ok: false,
        error: "missing_google_analytics_env",
        missing: missingEnv,
        step: "env",
        timings,
        debug,
      },
      500,
    );
  }

  let requestBody: RequestBody;

  try {
    requestBody = await parseRequestBody(context.request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid_json_body";

    timings.totalMs = nowMs() - requestStartedAt;
    return jsonResponse(
      {
        ok: false,
        error: message,
        step: "request_body",
        timings,
        debug,
      },
      400,
    );
  }

  let requestedReport: SyncReportName;

  try {
    requestedReport = getRequestedReport(context.request, requestBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_report";

    timings.totalMs = nowMs() - requestStartedAt;
    return jsonResponse(
      {
        ok: false,
        error: message,
        step: "request_report",
        timings,
        debug,
      },
      400,
    );
  }

  const propertyId = context.env.GA_PROPERTY_ID!.trim();
  const clientEmail = context.env.GA_CLIENT_EMAIL!.trim();
  const privateKey = context.env.GA_PRIVATE_KEY!;
  const dateFrom = requestBody.dateFrom?.trim() || "30daysAgo";
  const dateTo = requestBody.dateTo?.trim() || "today";
  const syncedAt = new Date().toISOString();

  let syncRunId = 0;
  const results = createEmptyResults();

  try {
    const createRunStartedAt = nowMs();
    syncRunId = await createSyncRun(context.env.DB, propertyId, dateFrom, dateTo);
    debug.push({
      step: "syncRun:create",
      durationMs: nowMs() - createRunStartedAt,
      status: "completed",
      detail: `syncRunId=${syncRunId}`,
    });

    const authStartedAt = nowMs();
    const accessToken = await getAccessToken(clientEmail, privateKey);
    timings.authMs = nowMs() - authStartedAt;
    debug.push({
      step: "auth",
      durationMs: timings.authMs,
      status: "completed",
    });

    await runSelectedReport(
      requestedReport,
      {
        daily: async () => {
          return syncDailyMetrics(
            context.env.DB,
            accessToken,
            propertyId,
            dateFrom,
            dateTo,
            syncedAt,
          );
        },
        trafficSources: () =>
          syncTrafficSources(
            context.env.DB,
            accessToken,
            propertyId,
            dateFrom,
            dateTo,
            syncedAt,
          ),
        topPages: () =>
          syncTopPages(
            context.env.DB,
            accessToken,
            propertyId,
            dateFrom,
            dateTo,
            syncedAt,
          ),
        countries: () =>
          syncCountries(
            context.env.DB,
            accessToken,
            propertyId,
            dateFrom,
            dateTo,
            syncedAt,
          ),
        devices: () =>
          syncDevices(
            context.env.DB,
            accessToken,
            propertyId,
            dateFrom,
            dateTo,
            syncedAt,
          ),
        events: () =>
          syncEvents(
            context.env.DB,
            accessToken,
            propertyId,
            dateFrom,
            dateTo,
            syncedAt,
          ),
      },
      results,
      timings,
      debug,
    );

    await completeSyncRun(context.env.DB, syncRunId);
    debug.push({
      step: "syncRun:complete",
      durationMs: 0,
      status: "completed",
    });
    timings.totalMs = nowMs() - requestStartedAt;

    return jsonResponse({
      ok: true,
      syncRunId,
      propertyId,
      dateFrom,
      dateTo,
      report: requestedReport,
      results,
      timings,
      debug,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "google_analytics_sync_failed";
    const [failedStep, failedError] = message.includes(":")
      ? [message.slice(0, message.indexOf(":")), message.slice(message.indexOf(":") + 1)]
      : ["sync", message];

    if (syncRunId > 0) {
      await failSyncRun(context.env.DB, syncRunId, failedError);
    }

    timings.totalMs = nowMs() - requestStartedAt;

    return jsonResponse(
      {
        ok: false,
        error: failedError,
        step: failedStep,
        syncRunId: syncRunId || undefined,
        propertyId,
        dateFrom,
        dateTo,
        report: requestedReport,
        results,
        timings,
        debug,
      },
      500,
    );
  }
}

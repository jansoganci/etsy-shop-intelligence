import { encryptSecret, randomToken, sha256 } from "./crypto";
import { upsertShop } from "./db";
import { exchangeAuthorizationCode, etsyFetch } from "./etsy";
import { LedgerEntriesAdapter } from "./adapters/ledger";
import { ListingInventoryAdapter } from "./adapters/inventory";
import { ListingFilesAdapter } from "./adapters/listingFiles";
import { ListingsAdapter } from "./adapters/listings";
import { PaymentsAdapter } from "./adapters/payments";
import { ReceiptsAdapter } from "./adapters/receipts";
import { ReviewsAdapter } from "./adapters/reviews";
import { ShopAdapter, ShopSectionsAdapter } from "./adapters/shop";
import { SnapshotsAdapter } from "./adapters/snapshots";
import { AdapterRegistry } from "./engine/registry";
import { resourcesFor } from "./engine/resources";
import { parseCommercePeriod } from "./engine/period";
import {
  cancelJob,
  createJob,
  expireZombieJobs,
  killAllActiveJobs,
  loadSoftBudgetDay,
  newId,
  pauseJob,
  resumeJob,
  softBudgetBlocks,
} from "./engine/repository";
import {
  dispatchOutbox,
  executeTaskMessage,
  planReadyResources,
  recoverAndDispatch,
} from "./engine/runtime";
import type { QueueTaskMessage } from "./engine/types";
import {
  cancelReconciliationRun,
  createManualReconciliationRun,
  dispatchReconciliationOutbox,
  executeReconciliationRun,
  getReconciliationRun,
  listReconciliationRuns,
  loadSourceState,
  ReconciliationSourceBusyError,
  type ReconciliationQueueMessage,
} from "./reconciliation/run";
import type {
  Env,
  EtsyShop,
  RequestedResource,
} from "./types";

const SCOPES = ["shops_r", "listings_r", "transactions_r"] as const;
const VALID_RESOURCES: RequestedResource[] = [
  "commerce",
  "shop",
  "listings",
  "reviews",
];

const registry = new AdapterRegistry()
  .register(new ShopAdapter())
  .register(new ShopSectionsAdapter())
  .register(new ListingsAdapter())
  .register(new ListingInventoryAdapter())
  .register(new ListingFilesAdapter())
  .register(new SnapshotsAdapter())
  .register(new ReceiptsAdapter())
  .register(new PaymentsAdapter())
  .register(new LedgerEntriesAdapter())
  .register(new ReviewsAdapter());

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isReconciliationQueueMessage(
  message: QueueTaskMessage | ReconciliationQueueMessage,
): message is ReconciliationQueueMessage {
  return "kind" in message && message.kind === "reconciliation";
}

function accessIdentity(request: Request): string | null {
  return request.headers.get("cf-access-authenticated-user-email");
}

function requireServiceRequest(request: Request): Response | null {
  if (!accessIdentity(request)) {
    return json({ ok: false, error: "access_identity_missing" }, 401);
  }
  return null;
}

async function oauthStart(request: Request, env: Env): Promise<Response> {
  const identity = accessIdentity(request);
  if (!identity) return json({ ok: false, error: "access_identity_missing" }, 401);
  const state = randomToken(32);
  const verifier = randomToken(64);
  const challenge = await sha256(verifier);
  const stateHash = await sha256(state);
  const identityHash = await sha256(identity.toLowerCase());
  const encryptedVerifier = await encryptSecret(verifier, env.ETSY_TOKEN_ENCRYPTION_KEY);
  await env.DB
    .prepare("DELETE FROM etsy_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL")
    .run();
  await env.DB.prepare(
    `
      INSERT INTO etsy_oauth_states (
        state_hash, pkce_verifier_ciphertext, pkce_verifier_iv,
        access_identity_hash, redirect_uri, expires_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))
    `,
  )
    .bind(
      stateHash,
      encryptedVerifier.ciphertext,
      encryptedVerifier.iv,
      identityHash,
      env.ETSY_REDIRECT_URI,
    )
    .run();
  const url = new URL("https://www.etsy.com/oauth/connect");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.ETSY_API_KEY,
    redirect_uri: env.ETSY_REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return Response.redirect(url.toString(), 302);
}

async function oauthCallback(request: Request, env: Env): Promise<Response> {
  const identity = accessIdentity(request);
  if (!identity) return json({ ok: false, error: "access_identity_missing" }, 401);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const appOrigin = env.APP_ORIGIN ?? new URL(env.ETSY_REDIRECT_URI).origin;
  if (oauthError) {
    return Response.redirect(
      `${appOrigin}/data-center?etsy=error&code=${encodeURIComponent(oauthError)}`,
      302,
    );
  }
  if (!state || !code) return json({ ok: false, error: "oauth_callback_invalid" }, 400);
  const row = await env.DB
    .prepare(
      `
        SELECT * FROM etsy_oauth_states
        WHERE state_hash=? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      `,
    )
    .bind(await sha256(state))
    .first<{
      state_hash: string;
      pkce_verifier_ciphertext: string;
      pkce_verifier_iv: string;
      access_identity_hash: string;
      redirect_uri: string;
    }>();
  if (!row || row.access_identity_hash !== (await sha256(identity.toLowerCase()))) {
    return json({ ok: false, error: "oauth_state_invalid" }, 400);
  }
  const { decryptSecret } = await import("./crypto");
  const verifier = await decryptSecret(
    row.pkce_verifier_ciphertext,
    row.pkce_verifier_iv,
    env.ETSY_TOKEN_ENCRYPTION_KEY,
  );
  const token = await exchangeAuthorizationCode(env, code, verifier, row.redirect_uri);
  const userId = token.access_token.split(".", 1)[0];
  if (!userId || !/^\d+$/.test(userId)) {
    return json({ ok: false, error: "etsy_user_id_missing" }, 502);
  }
  const temporaryShopId = `oauth-user-${userId}`;
  const temporaryAccess = await encryptSecret(token.access_token, env.ETSY_TOKEN_ENCRYPTION_KEY);
  const temporaryRefresh = await encryptSecret(token.refresh_token, env.ETSY_TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    `
      INSERT INTO etsy_connections (
        shop_id, etsy_user_id, scopes_json,
        access_token_ciphertext, access_token_iv,
        refresh_token_ciphertext, refresh_token_iv,
        access_token_expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected')
      ON CONFLICT(shop_id) DO UPDATE SET
        access_token_ciphertext=excluded.access_token_ciphertext,
        access_token_iv=excluded.access_token_iv,
        refresh_token_ciphertext=excluded.refresh_token_ciphertext,
        refresh_token_iv=excluded.refresh_token_iv,
        access_token_expires_at=excluded.access_token_expires_at,
        status='connected', updated_at=CURRENT_TIMESTAMP
    `,
  )
    .bind(
      temporaryShopId,
      userId,
      JSON.stringify(SCOPES),
      temporaryAccess.ciphertext,
      temporaryAccess.iv,
      temporaryRefresh.ciphertext,
      temporaryRefresh.iv,
      new Date(Date.now() + token.expires_in * 1000).toISOString(),
    )
    .run();
  const shopResponse = await etsyFetch<EtsyShop>(
    env,
    temporaryShopId,
    `/v3/application/users/${userId}/shops`,
  );
  const shop = shopResponse.body;
  const shopId = String(shop.shop_id);
  // Every API source table is owned by etsy_api_shops through a foreign key.
  // Persist the shop returned during OAuth immediately so a user can safely
  // start an individual Sales/Finance sync before ever running the optional
  // Shop sync card.
  await upsertShop(env.DB, shop);
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO etsy_connections (
          shop_id, etsy_user_id, shop_name, scopes_json,
          access_token_ciphertext, access_token_iv,
          refresh_token_ciphertext, refresh_token_iv,
          access_token_expires_at, status
        ) SELECT ?, etsy_user_id, ?, scopes_json,
          access_token_ciphertext, access_token_iv,
          refresh_token_ciphertext, refresh_token_iv,
          access_token_expires_at, 'connected'
        FROM etsy_connections WHERE shop_id=?
        ON CONFLICT(shop_id) DO UPDATE SET
          etsy_user_id=excluded.etsy_user_id, shop_name=excluded.shop_name,
          scopes_json=excluded.scopes_json,
          access_token_ciphertext=excluded.access_token_ciphertext,
          access_token_iv=excluded.access_token_iv,
          refresh_token_ciphertext=excluded.refresh_token_ciphertext,
          refresh_token_iv=excluded.refresh_token_iv,
          access_token_expires_at=excluded.access_token_expires_at,
          status='connected', updated_at=CURRENT_TIMESTAMP
      `,
    ).bind(shopId, shop.shop_name ?? null, temporaryShopId),
    env.DB.prepare("DELETE FROM etsy_connections WHERE shop_id=?").bind(temporaryShopId),
    env.DB
      .prepare("UPDATE etsy_oauth_states SET used_at=CURRENT_TIMESTAMP WHERE state_hash=?")
      .bind(row.state_hash),
  ]);
  return Response.redirect(`${appOrigin}/data-center?etsy=connected`, 302);
}

async function connectionStatus(env: Env): Promise<Response> {
  const connection = await env.DB
    .prepare(
      `
        SELECT shop_id, shop_name, scopes_json, status, connected_at,
          last_api_success_at, access_token_expires_at
        FROM etsy_connections
        WHERE status <> 'disconnected'
        ORDER BY connected_at DESC LIMIT 1
      `,
    )
    .first<Record<string, unknown>>();
  const latest = await env.DB
    .prepare("SELECT * FROM etsy_sync_jobs ORDER BY created_at DESC LIMIT 1")
    .first<Record<string, unknown>>();
  return json({
    ok: true,
    connection: connection
      ? {
          shopId: connection.shop_id,
          shopName: connection.shop_name,
          scopes: JSON.parse(String(connection.scopes_json ?? "[]")),
          status: connection.status,
          connectedAt: connection.connected_at,
          lastApiSuccessAt: connection.last_api_success_at,
          accessTokenExpiresAt: connection.access_token_expires_at,
        }
      : null,
    latestRun: latest ? mapRun(latest) : null,
  });
}

async function startSync(request: Request, env: Env): Promise<Response> {
  let body: {
    resource?: string;
    period?: { from?: string; to?: string };
  };
  try {
    body = (await request.json()) as {
      resource?: string;
      period?: { from?: string; to?: string };
    };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!body.resource || !VALID_RESOURCES.includes(body.resource as RequestedResource)) {
    return json({ ok: false, error: "invalid_sync_resource" }, 422);
  }
  const requested = body.resource as RequestedResource;
  let periodFromTs: number | null = null;
  let periodToTs: number | null = null;
  let isPeriodRun = false;
  let periodResponse: {
    fromTs: number;
    toExclusiveTs: number;
    fromDate: string;
    toDate: string;
  } | null = null;

  if (requested === "commerce") {
    if (!body.period?.from || !body.period?.to) {
      return json({ ok: false, error: "period_required" }, 422);
    }
    const parsed = parseCommercePeriod(body.period.from, body.period.to, new Date());
    if (!parsed.ok) {
      return json({ ok: false, error: parsed.error }, 422);
    }
    periodFromTs = parsed.period.fromTs;
    periodToTs = parsed.period.toExclusiveTs;
    isPeriodRun = true;
    periodResponse = {
      fromTs: parsed.period.fromTs,
      toExclusiveTs: parsed.period.toExclusiveTs,
      fromDate: body.period.from,
      toDate: body.period.to,
    };
  } else if (body.period) {
    return json({ ok: false, error: "period_not_allowed" }, 422);
  }

  const resources = resourcesFor(requested);
  if (resources.length === 0) {
    return json(
      {
        ok: false,
        error: "sync_resource_adapter_pending",
        message:
          "This resource has not been migrated to the generic Queue sync engine yet.",
      },
      409,
    );
  }
  const connection = await env.DB
    .prepare(
      "SELECT shop_id FROM etsy_connections WHERE status='connected' ORDER BY connected_at DESC LIMIT 1",
    )
    .first<{ shop_id: string }>();
  if (!connection) return json({ ok: false, error: "etsy_not_connected" }, 409);
  await expireZombieJobs(env.DB);
  const active = await env.DB
    .prepare(
      `
        SELECT id FROM etsy_sync_jobs
        WHERE shop_id=? AND (
          status IN ('queued','running','retry_wait','rate_limited')
          OR COALESCE(control_state, 'running') IN ('paused', 'cancelling')
        )
        AND status NOT IN ('completed','cancelled','failed')
        LIMIT 1
      `,
    )
    .bind(connection.shop_id)
    .first<{ id: string }>();
  if (active) {
    return json({ ok: false, error: "sync_already_running", runId: active.id }, 409);
  }
  const runId = newId();
  await createJob(env.DB, {
    runId,
    shopId: connection.shop_id,
    requestedResource: requested,
    resources: resources.map((resource, ordinal) => ({
      resource,
      adapterVersion: registry.get(resource).version,
      ordinal,
    })),
    periodFromTs,
    periodToTs,
    isPeriodRun,
  });
  const now = new Date();
  await planReadyResources(env, registry, runId, now);
  try {
    await dispatchOutbox(env, now);
  } catch (error) {
    // The durable outbox is the source of truth; the scheduled dispatcher will
    // retry even if the immediate Queue hand-off is temporarily unavailable.
    console.error(
      "etsy_sync_initial_dispatch_deferred",
      error instanceof Error ? error.message : "unknown",
    );
  }
  return json(
    {
      ok: true,
      runId,
      resource: requested,
      ...(periodResponse ? { period: periodResponse } : {}),
      status: "queued",
    },
    202,
  );
}

async function retrySync(env: Env, runId: string): Promise<Response> {
  const run = await env.DB
    .prepare(
      `
        SELECT id, shop_id, status, current_resource
        FROM etsy_sync_jobs WHERE id=?
      `,
    )
    .bind(runId)
    .first<{
      id: string;
      shop_id: string;
      status: string;
      current_resource: string | null;
    }>();
  if (!run) return json({ ok: false, error: "sync_run_not_found" }, 404);
  if (!["partial", "failed", "source_pagination_exhausted"].includes(run.status)) {
    return json({ ok: false, error: "sync_run_not_retryable" }, 409);
  }
  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE etsy_sync_jobs SET status='queued',
            failed_tasks=0, next_resume_at=NULL,
            error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `,
      )
      .bind(runId),
    env.DB
      .prepare(
        `
          UPDATE etsy_sync_job_resources SET status='queued',
            error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE run_id=? AND status IN (
            'failed','partial','source_pagination_exhausted','retry_wait','rate_limited'
          )
        `,
      )
      .bind(runId),
    env.DB
      .prepare(
        `
          UPDATE etsy_sync_tasks SET status='queued', next_attempt_at=NULL,
            lease_token=NULL, lease_expires_at=NULL,
            last_error_code=NULL, last_error_message=NULL,
            updated_at=CURRENT_TIMESTAMP
          WHERE run_id=? AND status NOT IN ('completed','cancelled')
        `,
      )
      .bind(runId),
    env.DB
      .prepare(
        `
          INSERT INTO etsy_sync_outbox (
            id, dispatch_key, run_id, task_id, status
          )
          SELECT lower(hex(randomblob(16))),
            'manual-retry:' || id || ':' || attempt_count,
            run_id, id, 'pending'
          FROM etsy_sync_tasks
          WHERE run_id=? AND status='queued'
          ON CONFLICT(dispatch_key) DO NOTHING
        `,
      )
      .bind(runId),
  ]);
  await dispatchOutbox(env);
  return json({ ok: true, runId, status: "queued" }, 202);
}

function mapRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    shopId: row.shop_id,
    requestedResource: row.requested_resource,
    status: row.status,
    controlState: row.control_state ?? "running",
    pauseReason: row.pause_reason ?? null,
    currentResource: row.current_resource,
    qpdRemaining: row.rate_limit_qpd_remaining,
    qpsRemaining: row.rate_limit_qps_remaining,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalTasks: row.total_tasks == null ? undefined : Number(row.total_tasks),
    completedTasks:
      row.completed_tasks == null ? undefined : Number(row.completed_tasks),
    failedTasks: row.failed_tasks == null ? undefined : Number(row.failed_tasks),
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    nextResumeAt: row.next_resume_at ?? null,
  };
}

export function deriveCommerceStage(
  resources: Array<{ resource: unknown; status: unknown }>,
): "queued" | "shop" | "receipts" | "payments" | "ledger" | "finishing" {
  if (resources.length === 0) return "queued";
  const pending = resources.find(
    (row) => !["completed", "skipped"].includes(String(row.status ?? "")),
  );
  if (!pending) return "finishing";
  const resource = String(pending.resource ?? "");
  if (resource === "shop" || resource === "shop_sections") return "shop";
  if (resource === "receipts") return "receipts";
  if (resource === "payments") return "payments";
  if (resource === "ledger_entries") return "ledger";
  return "queued";
}

async function pauseSync(env: Env, runId: string): Promise<Response> {
  const ok = await pauseJob(env.DB, runId, "user_paused");
  if (!ok) return json({ ok: false, error: "sync_pause_rejected" }, 409);
  return json({ ok: true, runId, controlState: "paused" });
}

async function resumeSync(env: Env, runId: string): Promise<Response> {
  const ok = await resumeJob(env.DB, runId);
  if (!ok) return json({ ok: false, error: "sync_resume_rejected" }, 409);
  try {
    await dispatchOutbox(env);
  } catch (error) {
    console.error(
      "etsy_sync_resume_dispatch_deferred",
      error instanceof Error ? error.message : "unknown",
    );
  }
  return json({ ok: true, runId, controlState: "running" });
}

async function cancelSync(env: Env, runId: string): Promise<Response> {
  const ok = await cancelJob(env.DB, runId);
  if (!ok) return json({ ok: false, error: "sync_cancel_rejected" }, 409);
  return json({ ok: true, runId, controlState: "cancelled", status: "cancelled" });
}

async function killAllSync(env: Env): Promise<Response> {
  const connection = await env.DB
    .prepare(
      "SELECT shop_id FROM etsy_connections WHERE status='connected' ORDER BY connected_at DESC LIMIT 1",
    )
    .first<{ shop_id: string }>();
  const cancelled = await killAllActiveJobs(env.DB, connection?.shop_id ?? null);
  return json({ ok: true, cancelled });
}

function parseListRunsLimit(raw: string | null): number {
  const parsed = Number(raw ?? 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

async function listRuns(
  env: Env,
  options: { runId?: string; limit?: number; errorsOnly?: boolean } = {},
): Promise<Response> {
  const { runId, errorsOnly = false } = options;
  const limit = options.limit ?? 20;
  let rows: Record<string, unknown>[] = [];
  if (runId) {
    const row = await env.DB.prepare("SELECT * FROM etsy_sync_jobs WHERE id=?")
      .bind(runId)
      .first<Record<string, unknown>>();
    rows = row ? [row] : [];
  } else if (errorsOnly) {
    rows =
      (
        await env.DB.prepare(
          `
            SELECT * FROM etsy_sync_jobs
            WHERE status IN ('partial', 'failed', 'source_pagination_exhausted')
               OR (error_message IS NOT NULL AND TRIM(error_message) <> '')
               OR id IN (
                 SELECT run_id FROM etsy_sync_job_resources
                 WHERE error_message IS NOT NULL AND TRIM(error_message) <> ''
               )
            ORDER BY created_at DESC
            LIMIT ?
          `,
        )
          .bind(limit)
          .all<Record<string, unknown>>()
      ).results ?? [];
  } else {
    rows =
      (
        await env.DB.prepare(
          "SELECT * FROM etsy_sync_jobs ORDER BY created_at DESC LIMIT ?",
        )
          .bind(limit)
          .all<Record<string, unknown>>()
      ).results ?? [];
  }
  if (runId && rows.length === 0) return json({ ok: false, error: "sync_run_not_found" }, 404);
  const runs = [];
  for (const row of rows) {
    const resourceRows = await env.DB
      .prepare("SELECT * FROM etsy_sync_job_resources WHERE run_id=? ORDER BY ordinal")
      .bind(row.id)
      .all<Record<string, unknown>>();
    runs.push({
      ...mapRun(row),
      resources: (resourceRows.results ?? []).map((resource) => ({
        resource: resource.resource,
        status: resource.status,
        fetched: resource.fetched_count,
        inserted: resource.inserted_count,
        updated: resource.updated_count,
        unchanged: resource.unchanged_count,
        errors: resource.error_count,
        startedAt: resource.started_at,
        completedAt: resource.completed_at,
        errorCode: resource.error_code,
        errorMessage: resource.error_message,
      })),
    });
  }
  return json(runId ? { ok: true, run: runs[0] } : { ok: true, runs });
}

async function disconnect(env: Env): Promise<Response> {
  await env.DB.prepare(
    `
      UPDATE etsy_connections SET
        access_token_ciphertext='', access_token_iv='',
        refresh_token_ciphertext='', refresh_token_iv='',
        status='disconnected', updated_at=CURRENT_TIMESTAMP
      WHERE status <> 'disconnected'
    `,
  ).run();
  return json({ ok: true });
}

async function lightweightSyncStatus(env: Env): Promise<Response> {
  // Read-only: zombie expiry runs on the */5 cron (recoverAndDispatch), not on
  // every UI poll — polling must not write D1.
  const run = await env.DB
    .prepare(
      `
        SELECT id, shop_id, requested_resource, status, control_state, pause_reason,
          current_resource, total_tasks, completed_tasks, failed_tasks, fetched_count,
          rate_limit_qpd_remaining, rate_limit_qps_remaining,
          last_heartbeat_at, next_resume_at, error_code, error_message,
          created_at, updated_at, completed_at, started_at,
          COALESCE(is_period_run, 0) AS is_period_run,
          period_from_ts, period_to_ts
        FROM etsy_sync_jobs ORDER BY created_at DESC LIMIT 1
      `,
    )
    .first<Record<string, unknown>>();
  if (!run) return json({ ok: true, run: null });
  const taskCounts = await env.DB
    .prepare(
      `
        SELECT status, COUNT(*) AS count FROM etsy_sync_tasks
        WHERE run_id=? GROUP BY status
      `,
    )
    .bind(run.id)
    .all<{ status: string; count: number }>();
  const remainingParents = await env.DB
    .prepare(
      `
        SELECT COUNT(*) AS count FROM etsy_sync_tasks
        WHERE run_id=? AND status NOT IN (
          'completed','cancelled','failed','source_pagination_exhausted'
        )
      `,
    )
    .bind(run.id)
    .first<{ count: number }>();
  const resourceRows = await env.DB
    .prepare("SELECT * FROM etsy_sync_job_resources WHERE run_id=? ORDER BY ordinal")
    .bind(run.id)
    .all<Record<string, unknown>>();
  const softBudget = await loadSoftBudgetDay(env.DB);
  const resources = (resourceRows.results ?? []).map((resource) => ({
    resource: resource.resource,
    status: resource.status,
    fetched: resource.fetched_count,
    inserted: resource.inserted_count,
    updated: resource.updated_count,
    unchanged: resource.unchanged_count,
    errors: resource.error_count,
    startedAt: resource.started_at,
    completedAt: resource.completed_at,
    errorCode: resource.error_code,
    errorMessage: resource.error_message,
  }));
  const isPeriodRun = Number(run.is_period_run ?? 0) === 1;
  return json({
    ok: true,
    run: {
      ...mapRun(run),
      totalTasks: Number(run.total_tasks ?? 0),
      completedTasks: Number(run.completed_tasks ?? 0),
      failedTasks: Number(run.failed_tasks ?? 0),
      remainingParents: Number(remainingParents?.count ?? 0),
      fetched: Number(run.fetched_count ?? 0),
      lastHeartbeatAt: run.last_heartbeat_at,
      nextResumeAt: run.next_resume_at,
      isPeriodRun,
      period:
        isPeriodRun &&
        typeof run.period_from_ts === "number" &&
        typeof run.period_to_ts === "number"
          ? {
              fromTs: run.period_from_ts,
              toExclusiveTs: run.period_to_ts,
            }
          : null,
      stage: deriveCommerceStage(resources),
      softBudget: {
        dayKey: softBudget.dayKey,
        queueOps: softBudget.queueOps,
        d1WriteOps: softBudget.d1WriteOps,
      },
      taskCounts: Object.fromEntries(
        (taskCounts.results ?? []).map((row) => [row.status, Number(row.count)]),
      ),
      resources,
    },
  });
}

function parseReconciliationRunsLimit(raw: string | null): number {
  const parsed = Number(raw ?? 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

async function createReconciliationRun(env: Env): Promise<Response> {
  try {
    const run = await createManualReconciliationRun(env);
    if (!run) return json({ ok: false, error: "no_connected_shop" }, 409);
    return json({ ok: true, run }, run.status === "queued" ? 202 : 200);
  } catch (error) {
    if (error instanceof ReconciliationSourceBusyError) {
      return json(
        { ok: false, error: "reconciliation_source_busy", sourceBusy: error.busy },
        409,
      );
    }
    throw error;
  }
}

async function reconciliationStatus(env: Env): Promise<Response> {
  const runs = await listReconciliationRuns(env, 50);
  const connection = await env.DB
    .prepare("SELECT shop_id FROM etsy_connections WHERE status='connected' ORDER BY connected_at DESC LIMIT 1")
    .first<{ shop_id: string }>();
  const sourceState = connection ? await loadSourceState(env, connection.shop_id) : null;
  return json({
    ok: true,
    latestAttempt: runs[0] ?? null,
    latestCompleted: runs.find((run) => run.status === "completed") ?? null,
    sourceBusy: {
      etsySync: sourceState?.etsySync ?? false,
      csvImport: sourceState?.csvImport ?? false,
    },
  });
}

async function reconciliationHistory(env: Env, limit: number): Promise<Response> {
  return json({ ok: true, runs: await listReconciliationRuns(env, limit) });
}

async function reconciliationRun(env: Env, runId: string): Promise<Response> {
  const run = await getReconciliationRun(env, runId);
  if (!run) return json({ ok: false, error: "reconciliation_run_not_found" }, 404);
  return json({ ok: true, run });
}

async function cancelReconciliation(env: Env, runId: string): Promise<Response> {
  const cancelled = await cancelReconciliationRun(env, runId);
  if (!cancelled) return json({ ok: false, error: "reconciliation_cancel_rejected" }, 409);
  return json({ ok: true, runId, status: "cancelled" });
}

async function startIncrementalCommerce(env: Env): Promise<void> {
  try {
    const connection = await env.DB
      .prepare(
        "SELECT shop_id FROM etsy_connections WHERE status='connected' ORDER BY connected_at DESC LIMIT 1",
      )
      .first<{ shop_id: string }>();
    if (!connection) return;

    await expireZombieJobs(env.DB);
    const active = await env.DB
      .prepare(
        `
          SELECT id FROM etsy_sync_jobs
          WHERE shop_id=? AND (
            status IN ('queued','running','retry_wait','rate_limited')
            OR COALESCE(control_state, 'running') IN ('paused', 'cancelling')
          )
          AND status NOT IN ('completed','cancelled','failed')
          LIMIT 1
        `,
      )
      .bind(connection.shop_id)
      .first<{ id: string }>();
    if (active) {
      console.log("etsy_incremental_commerce_skipped_active_job", active.id);
      return;
    }

    const budget = await softBudgetBlocks(env.DB, new Date());
    if (budget.blocked) {
      console.log(
        "etsy_incremental_commerce_skipped_budget",
        budget.reason ?? "daily_budget",
      );
      return;
    }

    const resources = resourcesFor("commerce");
    const runId = newId();
    await createJob(env.DB, {
      runId,
      shopId: connection.shop_id,
      requestedResource: "commerce",
      isPeriodRun: false,
      resources: resources.map((resource, ordinal) => ({
        resource,
        adapterVersion: registry.get(resource).version,
        ordinal,
      })),
    });

    const now = new Date();
    await planReadyResources(env, registry, runId, now);
    try {
      await dispatchOutbox(env, now);
    } catch (error) {
      console.error(
        "etsy_incremental_commerce_dispatch_deferred",
        error instanceof Error ? error.message : "unknown",
      );
    }
  } catch (error) {
    console.error(
      "etsy_incremental_commerce_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const rejected = requireServiceRequest(request);
    if (rejected) return rejected;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/internal\/etsy/, "");
    try {
      if (request.method === "GET" && path === "/connection") return connectionStatus(env);
      if (request.method === "GET" && path === "/oauth/start") return oauthStart(request, env);
      if (request.method === "GET" && path === "/oauth/callback") return oauthCallback(request, env);
      if (request.method === "POST" && path === "/disconnect") return disconnect(env);
      if (request.method === "POST" && path === "/sync") return startSync(request, env);
      if (request.method === "POST" && path === "/reconciliation/runs") {
        return createReconciliationRun(env);
      }
      if (request.method === "GET" && path === "/reconciliation/status") {
        return reconciliationStatus(env);
      }
      if (request.method === "GET" && path === "/reconciliation/runs") {
        return reconciliationHistory(
          env,
          parseReconciliationRunsLimit(url.searchParams.get("limit")),
        );
      }
      const reconciliationRunMatch = path.match(/^\/reconciliation\/runs\/([0-9a-f-]+)$/);
      if (request.method === "GET" && reconciliationRunMatch) {
        return reconciliationRun(env, reconciliationRunMatch[1]);
      }
      const reconciliationCancelMatch = path.match(
        /^\/reconciliation\/runs\/([0-9a-f-]+)\/cancel$/,
      );
      if (request.method === "POST" && reconciliationCancelMatch) {
        return cancelReconciliation(env, reconciliationCancelMatch[1]);
      }
      if (request.method === "GET" && path === "/sync/status") {
        return lightweightSyncStatus(env);
      }
      if (request.method === "GET" && path === "/sync/runs") {
        return listRuns(env, {
          limit: parseListRunsLimit(url.searchParams.get("limit")),
          errorsOnly: url.searchParams.get("errorsOnly") === "1",
        });
      }
      const match = path.match(/^\/sync\/runs\/([0-9a-f-]+)$/);
      if (request.method === "GET" && match) return listRuns(env, { runId: match[1] });
      const retryMatch = path.match(/^\/sync\/runs\/([0-9a-f-]+)\/retry$/);
      if (request.method === "POST" && retryMatch) return retrySync(env, retryMatch[1]);
      const pauseMatch = path.match(/^\/sync\/runs\/([0-9a-f-]+)\/pause$/);
      if (request.method === "POST" && pauseMatch) return pauseSync(env, pauseMatch[1]);
      const resumeMatch = path.match(/^\/sync\/runs\/([0-9a-f-]+)\/resume$/);
      if (request.method === "POST" && resumeMatch) return resumeSync(env, resumeMatch[1]);
      const cancelMatch = path.match(/^\/sync\/runs\/([0-9a-f-]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch) return cancelSync(env, cancelMatch[1]);
      if (request.method === "POST" && path === "/sync/kill-all") {
        return killAllSync(env);
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      console.error("etsy_service_request_failed", {
        path,
        error: error instanceof Error ? error.message : "unknown",
      });
      return json(
        {
          ok: false,
          error: "etsy_service_failed",
          message: error instanceof Error ? error.message : "Etsy service failed.",
        },
        500,
      );
    }
  },
  async queue(
    batch: MessageBatch<QueueTaskMessage | ReconciliationQueueMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      if (isReconciliationQueueMessage(message.body)) {
        try {
          await executeReconciliationRun(env, message.body);
          message.ack();
        } catch (error) {
          console.error(
            "etsy_reconciliation_queue_failed",
            error instanceof Error ? error.message : "unknown",
          );
          message.retry({ delaySeconds: 30 });
        }
      } else {
        const result = await executeTaskMessage(env, registry, message.body);
        if (result.action === "retry") {
          message.retry({ delaySeconds: result.delaySeconds });
        } else {
          message.ack();
        }
        // This immediately hands off a normal continuation. If the Worker dies
        // before this point, the durable outbox is drained by the scheduled pass.
        await dispatchOutbox(env);
      }
    }
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron === "0 3 * * *") {
      await startIncrementalCommerce(env);
    }
    await expireZombieJobs(env.DB);
    await recoverAndDispatch(env, registry);
    await dispatchReconciliationOutbox(env);
  },
};

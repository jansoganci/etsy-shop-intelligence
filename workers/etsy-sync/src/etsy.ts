import { decryptSecret, encryptSecret } from "./crypto";
import type { D1Database, Env } from "./types";

const ETSY_API_ORIGIN = "https://api.etsy.com";

type ConnectionRow = {
  shop_id: string;
  etsy_user_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  access_token_expires_at: string;
  status: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export class EtsyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export async function exchangeAuthorizationCode(
  env: Env,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<Required<Pick<TokenResponse, "access_token" | "refresh_token" | "expires_in">>> {
  const response = await fetch(`${ETSY_API_ORIGIN}/v3/public/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-api-key": `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.ETSY_API_KEY,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token || !body.refresh_token || !body.expires_in) {
    throw new EtsyApiError(
      response.status,
      body.error ?? "oauth_exchange_failed",
      body.error_description ?? "Etsy OAuth token exchange failed.",
    );
  }
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
  };
}

async function refreshAccessToken(
  env: Env,
  connection: ConnectionRow,
): Promise<{ accessToken: string; connection: ConnectionRow }> {
  const refreshToken = await decryptSecret(
    connection.refresh_token_ciphertext,
    connection.refresh_token_iv,
    env.ETSY_TOKEN_ENCRYPTION_KEY,
  );
  const response = await fetch(`${ETSY_API_ORIGIN}/v3/public/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-api-key": `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.ETSY_API_KEY,
      refresh_token: refreshToken,
    }),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token || !body.refresh_token || !body.expires_in) {
    await env.DB.prepare(
      "UPDATE etsy_connections SET status = 'reauthorization_required', updated_at = CURRENT_TIMESTAMP WHERE shop_id = ?",
    )
      .bind(connection.shop_id)
      .run();
    throw new EtsyApiError(
      response.status,
      body.error ?? "oauth_refresh_failed",
      body.error_description ?? "Etsy OAuth refresh failed.",
    );
  }
  const [access, refresh] = await Promise.all([
    encryptSecret(body.access_token, env.ETSY_TOKEN_ENCRYPTION_KEY),
    encryptSecret(body.refresh_token, env.ETSY_TOKEN_ENCRYPTION_KEY),
  ]);
  const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();
  await env.DB.prepare(
    `
      UPDATE etsy_connections
      SET access_token_ciphertext = ?, access_token_iv = ?,
          refresh_token_ciphertext = ?, refresh_token_iv = ?,
          access_token_expires_at = ?, status = 'connected',
          updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ?
    `,
  )
    .bind(
      access.ciphertext,
      access.iv,
      refresh.ciphertext,
      refresh.iv,
      expiresAt,
      connection.shop_id,
    )
    .run();
  return {
    accessToken: body.access_token,
    connection: {
      ...connection,
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      access_token_expires_at: expiresAt,
      status: "connected",
    },
  };
}

async function loadConnection(db: D1Database, shopId: string): Promise<ConnectionRow> {
  const connection = await db
    .prepare("SELECT * FROM etsy_connections WHERE shop_id = ?")
    .bind(shopId)
    .first<ConnectionRow>();
  if (!connection || connection.status === "disconnected") {
    throw new EtsyApiError(401, "etsy_not_connected", "Etsy is not connected.");
  }
  return connection;
}

export async function etsyFetch<T>(
  env: Env,
  shopId: string,
  path: string,
  query?: URLSearchParams,
  allowRefresh = true,
): Promise<{ body: T; headers: Headers }> {
  let connection = await loadConnection(env.DB, shopId);
  let accessToken: string;
  const expiresAt = Date.parse(connection.access_token_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    ({ accessToken, connection } = await refreshAccessToken(env, connection));
  } else {
    accessToken = await decryptSecret(
      connection.access_token_ciphertext,
      connection.access_token_iv,
      env.ETSY_TOKEN_ENCRYPTION_KEY,
    );
  }

  const url = new URL(path, ETSY_API_ORIGIN);
  if (query) url.search = query.toString();
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-api-key": `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`,
    },
  });
  if (response.status === 401 && allowRefresh) {
    await refreshAccessToken(env, connection);
    return etsyFetch<T>(env, shopId, path, query, false);
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    let message = `Etsy API request failed with ${response.status}.`;
    try {
      const errorBody = (await response.json()) as { error?: string };
      if (errorBody.error) message = errorBody.error;
    } catch {
      // Never retain or log the response body.
    }
    throw new EtsyApiError(
      response.status,
      response.status === 429 ? "etsy_rate_limited" : "etsy_api_failed",
      message,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
  await env.DB.prepare(
    "UPDATE etsy_connections SET last_api_success_at = CURRENT_TIMESTAMP WHERE shop_id = ?",
  )
    .bind(shopId)
    .run();
  return { body: (await response.json()) as T, headers: response.headers };
}

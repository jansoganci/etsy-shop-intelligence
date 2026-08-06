interface Env {
  GA_PROPERTY_ID?: string;
  GA_CLIENT_EMAIL?: string;
  GA_PRIVATE_KEY?: string;
}

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleAnalyticsResponse = {
  rows?: Array<{
    metricValues?: Array<{
      value?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_ANALYTICS_REPORT_URL = "https://analyticsdata.googleapis.com/v1beta";

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

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  const missingEnv = getMissingEnv(context.env);

  if (missingEnv.length > 0) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_google_analytics_env",
        missing: missingEnv,
      },
      500,
    );
  }

  const propertyId = context.env.GA_PROPERTY_ID!.trim();
  const clientEmail = context.env.GA_CLIENT_EMAIL!.trim();
  const privateKey = context.env.GA_PRIVATE_KEY!;

  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const reportResponse = await fetch(
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
              startDate: "7daysAgo",
              endDate: "today",
            },
          ],
          metrics: [
            { name: "activeUsers" },
            { name: "sessions" },
            { name: "screenPageViews" },
          ],
        }),
      },
    );

    const reportResult = (await reportResponse.json()) as GoogleAnalyticsResponse;

    if (!reportResponse.ok) {
      throw new Error(
        reportResult.error?.message || "google_analytics_report_failed",
      );
    }

    const metricValues = reportResult.rows?.[0]?.metricValues ?? [];

    return jsonResponse({
      ok: true,
      propertyId,
      metrics: {
        activeUsers: toMetricNumber(metricValues[0]?.value),
        sessions: toMetricNumber(metricValues[1]?.value),
        screenPageViews: toMetricNumber(metricValues[2]?.value),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "google_analytics_test_failed";

    return jsonResponse(
      {
        ok: false,
        error: message,
      },
      500,
    );
  }
}

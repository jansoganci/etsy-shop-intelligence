interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

type Context = {
  request: Request;
  env: { ETSY_SYNC_SERVICE?: ServiceBinding };
  params: { path?: string | string[] };
};

function requestedPath(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join("/");
  return value ?? "";
}

export async function onRequest(context: Context): Promise<Response> {
  if (!context.env.ETSY_SYNC_SERVICE) {
    return Response.json(
      {
        ok: false,
        error: "etsy_sync_service_unavailable",
        message: "The Etsy sync Worker service binding is not configured.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const incomingUrl = new URL(context.request.url);
  const path = requestedPath(context.params.path);
  const internalUrl = new URL(`/internal/etsy/${path}`, "https://etsy-sync.internal");
  internalUrl.search = incomingUrl.search;

  const init: RequestInit = {
    method: context.request.method,
    headers: context.request.headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(context.request.method)) {
    init.body = context.request.body;
  }

  const response = await context.env.ETSY_SYNC_SERVICE.fetch(
    new Request(internalUrl, init),
  );
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}


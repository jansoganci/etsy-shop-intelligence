import type {
  DataCenterCoverage,
  EtsyReconciliation,
  FinancialCutoverEntity,
  FinancialCutoverStatus,
  EtsyReviewsQuery,
  EtsyReviewsResponse,
  IssueEntity,
  IssuesPage,
  IssueType,
  ReconciliationRun,
  ReconciliationRunStatusResponse,
} from "../types/dataCenter";

export async function fetchEtsyReviews(
  query: EtsyReviewsQuery = {},
): Promise<EtsyReviewsResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.rating) params.set("rating", String(query.rating));
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.listingId) params.set("listingId", query.listingId);
  if (query.sort) params.set("sort", query.sort);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));

  let response: Response;
  try {
    response = await fetch(`/api/data-center/reviews?${params.toString()}`);
  } catch {
    throw new Error("Review verileri yüklenirken bağlantı hatası oluştu.");
  }

  let data:
    | ({ ok: true } & EtsyReviewsResponse)
    | { ok: false; error?: string };
  try {
    data = await response.json() as typeof data;
  } catch {
    throw new Error("Review servisi geçersiz bir yanıt döndürdü.");
  }
  if (!response.ok || !data.ok) {
    if (!data.ok && data.error === "etsy_not_connected") {
      throw new Error("Review'ları görmek için önce Etsy mağazanı bağla.");
    }
    throw new Error("Review verileri yüklenemedi.");
  }

  return {
    reviews: data.reviews,
    summary: data.summary,
    listings: data.listings,
    pagination: data.pagination,
    filters: data.filters,
    capabilities: data.capabilities,
  };
}

export async function fetchDataCenterCoverage(): Promise<DataCenterCoverage> {
  let response: Response;
  try {
    response = await fetch("/api/data-center/coverage");
  } catch {
    throw new Error("Network error while loading data coverage.");
  }

  let data: ({ ok: true } & DataCenterCoverage) | { ok: false; error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    throw new Error("Data coverage could not be loaded.");
  }

  return { lastCompletedMonth: data.lastCompletedMonth, sources: data.sources };
}

export async function fetchEtsyReconciliation(): Promise<EtsyReconciliation> {
  const response = await fetch("/api/data-center/etsy-reconciliation");
  const data = (await response.json()) as
    | { ok: true; reconciliation: EtsyReconciliation }
    | { ok: false };
  if (!response.ok || !data.ok) {
    throw new Error("API / CSV mutabakatı yüklenemedi.");
  }
  return data.reconciliation;
}

async function reconciliationRunResponse(response: Response): Promise<ReconciliationRun> {
  const data = (await response.json()) as
    | { ok: true; run: ReconciliationRun }
    | { ok: false; error?: string };
  if (!response.ok || !data.ok) {
    if (!data.ok && data.error === "reconciliation_source_busy") {
      throw new Error("Etsy sync veya CSV import tamamlanmadan reconciliation başlatılamaz.");
    }
    throw new Error("Reconciliation çalışması yönetilemedi.");
  }
  return data.run;
}

export async function startReconciliationRun(): Promise<ReconciliationRun> {
  const response = await fetch("/api/etsy/reconciliation/runs", { method: "POST" });
  return reconciliationRunResponse(response);
}

export async function fetchReconciliationRunStatus(): Promise<ReconciliationRunStatusResponse> {
  const response = await fetch("/api/etsy/reconciliation/status");
  const data = (await response.json()) as
    | ({ ok: true } & ReconciliationRunStatusResponse)
    | { ok: false; error?: string };
  if (!response.ok || !data.ok) {
    throw new Error("Reconciliation çalışma durumu yüklenemedi.");
  }
  return {
    latestAttempt: data.latestAttempt,
    latestCompleted: data.latestCompleted,
    sourceBusy: data.sourceBusy,
  };
}

export async function cancelReconciliationRun(runId: string): Promise<void> {
  const response = await fetch(`/api/etsy/reconciliation/runs/${runId}/cancel`, {
    method: "POST",
  });
  const data = (await response.json()) as { ok: boolean };
  if (!response.ok || !data.ok) {
    throw new Error("Reconciliation çalışması iptal edilemedi.");
  }
}

export type ReconciliationIssuesFilter = {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
};

function issuesParams(entity: IssueEntity, type: IssueType, options: ReconciliationIssuesFilter): URLSearchParams {
  const params = new URLSearchParams({ entity, type });
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  return params;
}

/** Export always uses the exact same filters as the on-screen list (plan §9.8). */
export function reconciliationIssuesExportUrl(
  entity: IssueEntity,
  type: IssueType,
  options: Pick<ReconciliationIssuesFilter, "from" | "to"> = {},
): string {
  return `/api/data-center/etsy-reconciliation/issues/export.csv?${issuesParams(entity, type, options).toString()}`;
}

export async function fetchReconciliationIssues(
  entity: IssueEntity,
  type: IssueType,
  options: ReconciliationIssuesFilter = {},
): Promise<IssuesPage> {
  const params = issuesParams(entity, type, options);

  let response: Response;
  try {
    response = await fetch(`/api/data-center/etsy-reconciliation/issues?${params.toString()}`);
  } catch {
    throw new Error("Network error while loading reconciliation issues.");
  }

  let data: ({ ok: true } & IssuesPage) | { ok: false; error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    throw new Error("Mutabakat detayları yüklenemedi.");
  }

  return { entity: data.entity, type: data.type, items: data.items, limit: data.limit, offset: data.offset, hasMore: data.hasMore };
}

type FinancialCutoverPayload = {
  shopId: string;
  settings: FinancialCutoverStatus["settings"];
  readiness: FinancialCutoverStatus["readiness"];
};

function toFinancialCutoverStatus(data: FinancialCutoverPayload): FinancialCutoverStatus {
  return { shopId: data.shopId, settings: data.settings, readiness: data.readiness };
}

export async function fetchFinancialCutoverStatus(): Promise<FinancialCutoverStatus> {
  let response: Response;
  try {
    response = await fetch("/api/data-center/financial-cutover");
  } catch {
    throw new Error("Network error while loading financial cutover status.");
  }

  let data: ({ ok: true } & FinancialCutoverPayload) | { ok: false; error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    if (!data.ok && data.error === "no_connected_shop") {
      throw new Error("Önce Etsy mağazanı bağla.");
    }
    throw new Error("Financial cutover durumu yüklenemedi.");
  }

  return toFinancialCutoverStatus(data);
}

/**
 * Result of a cutover toggle attempt. `blocked` is a distinct, expected
 * outcome (not an Error) so the caller can render the server's own
 * blockingReasons/warnings verbatim instead of the frontend guessing why.
 */
export type FinancialCutoverUpdateResult =
  | { ok: true; status: FinancialCutoverStatus }
  | { ok: false; blocked: true; blockingReasons: string[]; warnings: string[] };

export async function updateFinancialCutover(
  entity: FinancialCutoverEntity,
  enabled: boolean,
): Promise<FinancialCutoverUpdateResult> {
  let response: Response;
  try {
    response = await fetch("/api/data-center/financial-cutover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity, enabled }),
    });
  } catch {
    throw new Error("Network error while updating financial cutover settings.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (response.status === 409 && (data as { error?: string })?.error === "cutover_not_ready") {
    const failure = data as { blockingReasons?: string[]; warnings?: string[] };
    return {
      ok: false,
      blocked: true,
      blockingReasons: failure.blockingReasons ?? [],
      warnings: failure.warnings ?? [],
    };
  }

  const success = data as ({ ok: true } & FinancialCutoverPayload) | { ok: false; error?: string };
  if (!response.ok || !success.ok) {
    if (!success.ok && success.error === "no_connected_shop") {
      throw new Error("Önce Etsy mağazanı bağla.");
    }
    throw new Error("Financial cutover ayarı güncellenemedi.");
  }

  return { ok: true, status: toFinancialCutoverStatus(success) };
}

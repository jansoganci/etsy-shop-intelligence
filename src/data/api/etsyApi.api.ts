import type {
  CommerceCoverage,
  CommercePeriodInput,
  CommerceSummary,
  EtsyConnectionStatus,
  EtsySyncResource,
  EtsySyncRun,
} from "../types/etsyApi";

type ApiFailure = {
  ok: false;
  error?: string;
  message?: string;
  runId?: string;
};

async function read<T>(response: Response, fallback: string): Promise<T> {
  let data: (T & { ok: true }) | ApiFailure;
  try {
    data = (await response.json()) as (T & { ok: true }) | ApiFailure;
  } catch {
    throw new Error("Server returned an invalid Etsy API response.");
  }
  if (!response.ok || !data.ok) {
    const failure = data as ApiFailure;
    if (failure.error === "sync_already_running") {
      throw new Error("Başka bir Etsy senkronizasyonu zaten çalışıyor.");
    }
    if (failure.error === "etsy_not_connected") {
      throw new Error("Önce Etsy mağazanı bağla.");
    }
    throw new Error(failure.message ?? fallback);
  }
  return data;
}

export async function fetchEtsyConnection(): Promise<EtsyConnectionStatus> {
  const data = await read<{ connection: EtsyConnectionStatus["connection"]; latestRun: EtsyConnectionStatus["latestRun"] }>(
    await fetch("/api/etsy/connection"),
    "Etsy bağlantı durumu yüklenemedi.",
  );
  return { connection: data.connection, latestRun: data.latestRun };
}

export type FetchEtsySyncRunsOptions = {
  limit?: number;
  errorsOnly?: boolean;
};

export async function fetchEtsySyncRuns(
  options: FetchEtsySyncRunsOptions = {},
): Promise<EtsySyncRun[]> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.errorsOnly) params.set("errorsOnly", "1");
  const query = params.toString();
  const data = await read<{ runs: EtsySyncRun[] }>(
    await fetch(`/api/etsy/sync/runs${query ? `?${query}` : ""}`),
    "Etsy sync geçmişi yüklenemedi.",
  );
  return data.runs;
}

export async function fetchEtsySyncStatus(): Promise<EtsySyncRun | null> {
  const data = await read<{ run: EtsySyncRun | null }>(
    await fetch("/api/etsy/sync/status"),
    "Etsy sync durumu yüklenemedi.",
  );
  return data.run;
}

export async function startEtsySync(
  resource: EtsySyncResource,
  period?: CommercePeriodInput,
): Promise<string> {
  const body: { resource: EtsySyncResource; period?: CommercePeriodInput } = { resource };
  if (period) {
    body.period = period;
  }

  const data = await read<{ runId: string }>(
    await fetch("/api/etsy/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "Etsy senkronizasyonu başlatılamadı.",
  );
  return data.runId;
}

export type FetchCommerceCoverageOptions = {
  limit?: number;
};

export async function fetchCommerceCoverage(
  options: FetchCommerceCoverageOptions = {},
): Promise<CommerceCoverage> {
  const params = new URLSearchParams();
  if (options.limit != null) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const data = await read<CommerceCoverage>(
    await fetch(`/api/data-center/commerce-coverage${query ? `?${query}` : ""}`),
    "Commerce coverage yüklenemedi.",
  );
  return {
    watermark: data.watermark,
    periods: data.periods,
    csvPresence: data.csvPresence,
  };
}

export async function fetchCommerceSummary(runId: string): Promise<CommerceSummary> {
  const params = new URLSearchParams({ runId });
  const data = await read<CommerceSummary>(
    await fetch(`/api/data-center/commerce-summary?${params.toString()}`),
    "Commerce özeti yüklenemedi.",
  );
  return {
    runId: data.runId,
    period: data.period,
    status: data.status,
    recordsFetched: data.recordsFetched,
    orderCount: data.orderCount,
    unitsSold: data.unitsSold,
    grossSales: data.grossSales,
    discounts: data.discounts,
    refunds: data.refunds,
    etsyFees: data.etsyFees,
    netSales: data.netSales,
    warnings: data.warnings,
  };
}

export async function disconnectEtsy(): Promise<void> {
  await read<Record<string, never>>(
    await fetch("/api/etsy/disconnect", { method: "POST" }),
    "Etsy bağlantısı kaldırılamadı.",
  );
}

export async function retryEtsySync(runId: string): Promise<void> {
  await read<{ runId: string }>(
    await fetch(`/api/etsy/sync/runs/${encodeURIComponent(runId)}/retry`, {
      method: "POST",
    }),
    "Etsy senkronizasyonu devam ettirilemedi.",
  );
}

export async function pauseEtsySync(runId: string): Promise<void> {
  await read<{ runId: string }>(
    await fetch(`/api/etsy/sync/runs/${encodeURIComponent(runId)}/pause`, {
      method: "POST",
    }),
    "Etsy senkronizasyonu duraklatılamadı.",
  );
}

export async function resumeEtsySync(runId: string): Promise<void> {
  await read<{ runId: string }>(
    await fetch(`/api/etsy/sync/runs/${encodeURIComponent(runId)}/resume`, {
      method: "POST",
    }),
    "Etsy senkronizasyonu devam ettirilemedi.",
  );
}

export async function cancelEtsySync(runId: string): Promise<void> {
  await read<{ runId: string }>(
    await fetch(`/api/etsy/sync/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    }),
    "Etsy senkronizasyonu iptal edilemedi.",
  );
}

export async function killAllEtsySync(): Promise<number> {
  const data = await read<{ cancelled: number }>(
    await fetch("/api/etsy/sync/kill-all", { method: "POST" }),
    "Aktif Etsy senkronizasyonları durdurulamadı.",
  );
  return data.cancelled;
}

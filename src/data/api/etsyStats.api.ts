import type {
  EtsyMonthlyStatsInput,
  EtsyMonthlyStatsRecord,
  EtsyStatsListResponse,
  EtsyStatsValidation,
} from "../types/etsyStats";

type ApiFailure = {
  ok: false;
  error?: string;
  message?: string;
  errors?: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Server returned an invalid response.");
  }
}

function failureMessage(failure: ApiFailure, fallback: string): string {
  return failure.errors?.join(" ") || failure.message || fallback;
}

export async function fetchEtsyStats(): Promise<EtsyStatsListResponse> {
  let response: Response;
  try {
    response = await fetch("/api/etsy-stats");
  } catch {
    throw new Error("Network error while loading Etsy Stats.");
  }

  const data = await readJson<
    ({ ok: true } & EtsyStatsListResponse) | ApiFailure
  >(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Etsy Stats could not be loaded."));
  }

  return { stats: data.stats, summary: data.summary };
}

export async function validateEtsyStats(
  payload: unknown,
): Promise<EtsyStatsValidation> {
  let response: Response;
  try {
    response = await fetch("/api/etsy-stats/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Network error while validating Etsy Stats.");
  }

  const data = await readJson<
    ({ ok: boolean } & EtsyStatsValidation) | ApiFailure
  >(response);
  if (!("valid" in data)) {
    throw new Error(failureMessage(data as ApiFailure, "Etsy Stats could not be validated."));
  }

  return {
    valid: data.valid,
    errors: data.errors,
    warnings: data.warnings,
    normalized: data.normalized,
  };
}

export async function saveEtsyStats(
  payload: EtsyMonthlyStatsInput,
): Promise<EtsyMonthlyStatsRecord> {
  let response: Response;
  try {
    response = await fetch(`/api/etsy-stats/${payload.month}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Network error while saving Etsy Stats.");
  }

  const data = await readJson<
    { ok: true; stats: EtsyMonthlyStatsRecord } | ApiFailure
  >(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Etsy Stats could not be saved."));
  }

  return data.stats;
}

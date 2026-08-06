import type { CombinedAnalyticsResponse } from "../types/combinedAnalytics";

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

export async function fetchCombinedAnalytics(): Promise<CombinedAnalyticsResponse> {
  let response: Response;
  try {
    response = await fetch("/api/combined-analytics");
  } catch {
    throw new Error("Network error while loading combined analytics.");
  }

  const data = await readJson<CombinedAnalyticsResponse | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Combined analytics could not be loaded."));
  }

  return data;
}

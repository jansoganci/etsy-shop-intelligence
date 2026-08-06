import type { IntelligenceOverviewResponse } from "../types/intelligence";

type IntelligenceFailure = {
  ok: false;
  error: string;
};

function formatIntelligenceError(error: string): string {
  if (error === "no_sales_data") {
    return "No Etsy sales data is available yet.";
  }

  if (error === "invalid_month") {
    return "The selected month is invalid.";
  }

  if (error === "month_outside_coverage") {
    return "The selected month is outside the imported sales coverage.";
  }

  return "Shop intelligence could not be calculated.";
}

export async function getIntelligenceOverview(month?: string): Promise<IntelligenceOverviewResponse> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  let response: Response;

  try {
    response = await fetch(`/api/intelligence/overview${query}`);
  } catch {
    throw new Error("Network error while loading shop intelligence.");
  }

  let data: IntelligenceOverviewResponse | IntelligenceFailure;

  try {
    data = (await response.json()) as IntelligenceOverviewResponse | IntelligenceFailure;
  } catch {
    throw new Error("Shop intelligence API returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.ok ? "Failed to load shop intelligence." : formatIntelligenceError(data.error));
  }

  return data;
}

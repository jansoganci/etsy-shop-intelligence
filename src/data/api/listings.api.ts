import type {
  ListingInput,
  ListingPerformance,
  ListingRecord,
  ListingsSummary,
  ListingVersionRecord,
} from "../types/listings";

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

export async function fetchListings(): Promise<{
  listings: ListingRecord[];
  summary: ListingsSummary;
}> {
  let response: Response;
  try {
    response = await fetch("/api/listings");
  } catch {
    throw new Error("Network error while loading listings.");
  }

  const data = await readJson<
    ({ ok: true; listings: ListingRecord[]; summary: ListingsSummary }) | ApiFailure
  >(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Listings could not be loaded."));
  }

  return { listings: data.listings, summary: data.summary };
}

export async function fetchListing(listingId: string): Promise<ListingRecord> {
  let response: Response;
  try {
    response = await fetch(`/api/listings/${encodeURIComponent(listingId)}`);
  } catch {
    throw new Error("Network error while loading the listing.");
  }

  const data = await readJson<({ ok: true; listing: ListingRecord }) | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Listing could not be loaded."));
  }

  return data.listing;
}

export async function fetchListingHistory(listingId: string): Promise<ListingVersionRecord[]> {
  let response: Response;
  try {
    response = await fetch(`/api/listings/${encodeURIComponent(listingId)}/history`);
  } catch {
    throw new Error("Network error while loading listing history.");
  }

  const data = await readJson<({ ok: true; versions: ListingVersionRecord[] }) | ApiFailure>(
    response,
  );
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Listing history could not be loaded."));
  }

  return data.versions;
}

export async function fetchListingPerformance(listingId: string): Promise<ListingPerformance> {
  let response: Response;
  try {
    response = await fetch(`/api/listings/${encodeURIComponent(listingId)}/performance`);
  } catch {
    throw new Error("Network error while loading listing performance.");
  }

  const data = await readJson<({ ok: true; performance: ListingPerformance }) | ApiFailure>(
    response,
  );
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Listing performance could not be loaded."));
  }

  return data.performance;
}

export async function saveListing(
  input: ListingInput,
): Promise<{ listing: ListingRecord; versionCreated: boolean }> {
  let response: Response;
  try {
    response = await fetch(`/api/listings/${encodeURIComponent(input.listingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Network error while saving the listing.");
  }

  const data = await readJson<
    ({ ok: true; listing: ListingRecord; versionCreated: boolean }) | ApiFailure
  >(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Listing could not be saved."));
  }

  return { listing: data.listing, versionCreated: data.versionCreated };
}

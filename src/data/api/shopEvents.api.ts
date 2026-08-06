import type { ShopEventInput, ShopEventRecord } from "../types/shopEvents";

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

export async function fetchShopEvents(filters: {
  listingId?: string;
  eventType?: string;
} = {}): Promise<ShopEventRecord[]> {
  const params = new URLSearchParams();
  if (filters.listingId) params.set("listingId", filters.listingId);
  if (filters.eventType) params.set("eventType", filters.eventType);
  const query = params.toString();

  let response: Response;
  try {
    response = await fetch(`/api/shop-events${query ? `?${query}` : ""}`);
  } catch {
    throw new Error("Network error while loading Shop Journal events.");
  }

  const data = await readJson<({ ok: true; events: ShopEventRecord[] }) | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Shop Journal could not be loaded."));
  }

  return data.events;
}

export async function createShopEvent(input: ShopEventInput): Promise<ShopEventRecord> {
  let response: Response;
  try {
    response = await fetch("/api/shop-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Network error while saving the event.");
  }

  const data = await readJson<({ ok: true; event: ShopEventRecord }) | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Event could not be saved."));
  }

  return data.event;
}

export async function deleteShopEvent(id: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/shop-events/${id}`, { method: "DELETE" });
  } catch {
    throw new Error("Network error while deleting the event.");
  }

  const data = await readJson<({ ok: true }) | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Event could not be deleted."));
  }
}

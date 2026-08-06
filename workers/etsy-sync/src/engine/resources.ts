import type { RequestedResource } from "../types";

export const PUBLIC_RESOURCE_GRAPH: Record<RequestedResource, readonly string[]> = {
  shop: ["shop", "shop_sections"],
  listings: [
    "shop",
    "listings",
    "listing_inventory",
    "listing_files",
    "snapshots",
  ],
  reviews: ["shop", "reviews"],
  commerce: ["shop", "receipts", "payments", "ledger_entries"],
} as const;

export function resourcesFor(requested: RequestedResource): string[] {
  return [...PUBLIC_RESOURCE_GRAPH[requested]];
}

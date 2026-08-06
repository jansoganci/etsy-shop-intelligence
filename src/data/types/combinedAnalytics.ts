export type QuadrantLabel =
  | "high_traffic_low_sales"
  | "low_traffic_high_sales"
  | "high_traffic_high_sales"
  | "low_traffic_low_sales";

export type CombinedAnalyticsGuardrails = {
  attributionDisclaimer: string;
  commonRange: { from: string; to: string } | null;
  matchedListingCount: number;
  activeListingCount: number;
  listingMatchRate: number | null;
  matchedPageRows: number;
  totalPageRows: number;
  pageMatchRate: number | null;
  meetsMinimumData: boolean;
  reasons: string[];
};

export type CombinedAnalyticsRow = {
  listingId: string;
  listingTitle: string | null;
  pageViews: number;
  sessions: number;
  orderCount: number;
  unitsSold: number;
  quadrant: QuadrantLabel;
};

export type CombinedAnalyticsAvailable = {
  ok: true;
  available: true;
  guardrails: CombinedAnalyticsGuardrails;
  rows: CombinedAnalyticsRow[];
  quadrantMedians: { trafficMedian: number; salesMedian: number };
};

export type CombinedAnalyticsUnavailable = {
  ok: true;
  available: false;
  reason: "no_ga_top_pages" | "date_range_unresolved";
};

export type CombinedAnalyticsResponse = CombinedAnalyticsAvailable | CombinedAnalyticsUnavailable;

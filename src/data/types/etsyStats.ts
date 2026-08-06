export const ETSY_TRAFFIC_SOURCE_KEYS = [
  "etsy_app_and_other_pages",
  "etsy_search",
  "etsy_marketing_and_seo",
  "direct_and_other_traffic",
  "social_media",
  "etsy_ads",
] as const;

export type EtsyTrafficSourceKey = (typeof ETSY_TRAFFIC_SOURCE_KEYS)[number];

export type EtsyTrafficSourceValue = {
  visits: number;
  sharePercent: number | null;
};

export type EtsyMonthlyStatsInput = {
  month: string;
  currency: "USD";
  visits: number;
  orders: number;
  conversionRate: number;
  revenue: number;
  itemFavorites: number;
  shopFollows: number;
  reviews: number;
  repeatBuyers: number;
  citiesReached: number;
  abandonedCarts: number;
  trafficSources: Record<EtsyTrafficSourceKey, EtsyTrafficSourceValue>;
  notes: string | null;
};

export type EtsyMonthlyStatsRecord = EtsyMonthlyStatsInput & {
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type EtsyStatsSummary = {
  count: number;
  latestMonth: string | null;
  firstExpectedMonth: string | null;
  lastExpectedMonth: string;
  missingMonths: string[];
};

export type EtsyStatsListResponse = {
  stats: EtsyMonthlyStatsRecord[];
  summary: EtsyStatsSummary;
};

export type EtsyStatsValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: EtsyMonthlyStatsInput | null;
};

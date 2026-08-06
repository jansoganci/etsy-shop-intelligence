export type ListingStatus = "active" | "inactive" | "sold_out" | "draft" | "expired";
export type ListingSource = "manual" | "manual_only" | "etsy_api";

export type ListingRecord = {
  listingId: string;
  url: string;
  status: ListingStatus;
  source: ListingSource;
  firstSeenAt: string;
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  currency: string;
  effectiveAt: string;
  changeNote: string | null;
  updatedAt: string;
};

export type ListingVersionRecord = {
  id: number;
  effectiveAt: string;
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  status: ListingStatus;
  changeNote: string | null;
  createdAt: string;
};

export type ListingsSummary = {
  count: number;
  activeCount: number;
  missingAltTextCount: number;
  apiCount: number;
  etsyConnected: boolean;
};

export type ListingInput = {
  listingId: string;
  url: string;
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  currency: "USD";
  status: "active" | "inactive";
  effectiveAt: string;
  changeNote: string | null;
};

export type ListingValidationErrors = {
  errors: string[];
  warnings: string[];
};

export type ListingPerformance = {
  totalOrders: number;
  totalUnits: number;
  totalGrossSalesUsd: number | null;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  currencyValid: boolean;
};

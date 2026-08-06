export const MIN_MATCHED_LISTINGS = 3;

export type GuardrailStatus = {
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

export function computeGuardrailStatus(input: {
  totalPageRows: number;
  matchedPageRows: number;
  activeListingCount: number;
  matchedListingCount: number;
  commonRange: { from: string; to: string } | null;
}): GuardrailStatus {
  const { totalPageRows, matchedPageRows, activeListingCount, matchedListingCount, commonRange } = input;

  const listingMatchRate = activeListingCount > 0 ? matchedListingCount / activeListingCount : null;
  const pageMatchRate = totalPageRows > 0 ? matchedPageRows / totalPageRows : null;
  const meetsMinimumData = matchedListingCount >= MIN_MATCHED_LISTINGS;

  const reasons: string[] = [];
  if (!meetsMinimumData) {
    reasons.push(
      `Only ${matchedListingCount} listing(s) matched Google Analytics traffic; need at least ${MIN_MATCHED_LISTINGS}.`,
    );
  }
  if (!commonRange) {
    reasons.push("The Google Analytics date range could not be resolved.");
  }

  return {
    attributionDisclaimer:
      "This is a proxy signal, not attribution. It does not prove traffic caused (or failed to cause) sales.",
    commonRange,
    matchedListingCount,
    activeListingCount,
    listingMatchRate,
    matchedPageRows,
    totalPageRows,
    pageMatchRate,
    meetsMinimumData,
    reasons,
  };
}

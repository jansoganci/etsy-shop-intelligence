// Etsy prefixes listing URLs with a two-letter locale segment for
// non-default storefront locales (e.g. /de/listing/…, /uk/listing/…,
// /fr/listing/…) -- confirmed against real synced ga_top_pages data, where
// roughly half of all listing page views carried one of these prefixes.
const LISTING_PATH_PATTERN = /^\/(?:[a-z]{2}\/)?listing\/(\d+)(?:[/?#]|$)/i;

export function extractListingIdFromPagePath(pagePath: string): string | null {
  const trimmed = pagePath.trim();
  if (!trimmed) {
    return null;
  }

  const match = LISTING_PATH_PATTERN.exec(trimmed);
  return match ? match[1] : null;
}

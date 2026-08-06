const COUNTRY_FILTER_ALIASES: Record<string, string> = {
  us: "United States",
  usa: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "united states of america": "United States",
  uk: "United Kingdom",
  gb: "United Kingdom",
  "great britain": "United Kingdom",
  uae: "United Arab Emirates",
  nl: "The Netherlands",
  netherlands: "The Netherlands",
  "the netherlands": "The Netherlands",
};

export function normalizeCountryFilterValue(value: string | null | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  const alias = COUNTRY_FILTER_ALIASES[trimmed.toLowerCase()];

  return alias ?? trimmed;
}

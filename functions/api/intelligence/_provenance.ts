import type { PaymentDataSource } from "./_financials";

export type DataProvenance = PaymentDataSource | "mixed";

const KNOWN_SOURCES: ReadonlySet<PaymentDataSource> = new Set([
  "csv_upload",
  "etsy_api",
  "etsy_api+csv",
]);

export function isPaymentDataSource(value: string): value is PaymentDataSource {
  return KNOWN_SOURCES.has(value as PaymentDataSource);
}

/** Collapse row-level data_source values into one panel label. */
export function aggregateProvenance(
  sources: ReadonlyArray<string | null | undefined>,
): DataProvenance | null {
  const normalized = new Set<PaymentDataSource>();

  for (const raw of sources) {
    const value = raw?.trim();
    if (value && isPaymentDataSource(value)) {
      normalized.add(value);
    }
  }

  if (normalized.size === 0) {
    return null;
  }

  if (normalized.size === 1) {
    return [...normalized][0];
  }

  return "mixed";
}

export type ListingTrafficSalesRow = {
  listingId: string;
  listingTitle: string | null;
  pageViews: number;
  sessions: number;
  orderCount: number;
  unitsSold: number;
};

export type QuadrantLabel =
  | "high_traffic_low_sales"
  | "low_traffic_high_sales"
  | "high_traffic_high_sales"
  | "low_traffic_low_sales";

export type ClassifiedRow = ListingTrafficSalesRow & { quadrant: QuadrantLabel };

export type QuadrantResult = {
  rows: ClassifiedRow[];
  trafficMedian: number;
  salesMedian: number;
};

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyRow(row: ListingTrafficSalesRow, trafficMedian: number, salesMedian: number): QuadrantLabel {
  const highTraffic = row.pageViews >= trafficMedian;
  const highSales = row.orderCount >= salesMedian;

  if (highTraffic && highSales) {
    return "high_traffic_high_sales";
  }
  if (highTraffic) {
    return "high_traffic_low_sales";
  }
  if (highSales) {
    return "low_traffic_high_sales";
  }
  return "low_traffic_low_sales";
}

/**
 * Splits listings into four quadrants using the median (not the average) of
 * traffic and sales across the set -- a median is resilient to the single
 * "hit" listing that would otherwise skew an average and misclassify most of
 * a small shop's catalog as "low traffic".
 */
export function classifyQuadrants(rows: ListingTrafficSalesRow[]): QuadrantResult {
  const trafficMedian = median(rows.map((row) => row.pageViews));
  const salesMedian = median(rows.map((row) => row.orderCount));

  return {
    rows: rows.map((row) => ({ ...row, quadrant: classifyRow(row, trafficMedian, salesMedian) })),
    trafficMedian,
    salesMedian,
  };
}

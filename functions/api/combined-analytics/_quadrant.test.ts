import { describe, expect, it } from "vitest";
import { classifyQuadrants, type ListingTrafficSalesRow } from "./_quadrant";

function row(overrides: Partial<ListingTrafficSalesRow> = {}): ListingTrafficSalesRow {
  return {
    listingId: "1",
    listingTitle: "Test listing",
    pageViews: 0,
    sessions: 0,
    orderCount: 0,
    unitsSold: 0,
    ...overrides,
  };
}

describe("classifyQuadrants", () => {
  it("handles an empty array safely", () => {
    const result = classifyQuadrants([]);

    expect(result.rows).toEqual([]);
    expect(result.trafficMedian).toBe(0);
    expect(result.salesMedian).toBe(0);
  });

  it("classifies a single listing as high/high (it equals its own median)", () => {
    const result = classifyQuadrants([row({ pageViews: 50, orderCount: 2 })]);

    expect(result.trafficMedian).toBe(50);
    expect(result.salesMedian).toBe(2);
    expect(result.rows[0].quadrant).toBe("high_traffic_high_sales");
  });

  it("computes the median for an even-length set", () => {
    const result = classifyQuadrants([
      row({ listingId: "a", pageViews: 10, orderCount: 1 }),
      row({ listingId: "b", pageViews: 30, orderCount: 3 }),
    ]);

    expect(result.trafficMedian).toBe(20);
    expect(result.salesMedian).toBe(2);
  });

  it("computes the median for an odd-length set", () => {
    const result = classifyQuadrants([
      row({ listingId: "a", pageViews: 10 }),
      row({ listingId: "b", pageViews: 20 }),
      row({ listingId: "c", pageViews: 90 }),
    ]);

    expect(result.trafficMedian).toBe(20);
  });

  it("puts a value exactly at the median on the high side", () => {
    const result = classifyQuadrants([
      row({ listingId: "a", pageViews: 10, orderCount: 10 }),
      row({ listingId: "b", pageViews: 20, orderCount: 20 }),
      row({ listingId: "c", pageViews: 30, orderCount: 30 }),
    ]);

    const median = result.rows.find((r) => r.listingId === "b")!;
    expect(median.quadrant).toBe("high_traffic_high_sales");
  });

  it("classifies all four quadrants correctly", () => {
    const result = classifyQuadrants([
      row({ listingId: "hh", pageViews: 100, orderCount: 10 }),
      row({ listingId: "hl", pageViews: 100, orderCount: 0 }),
      row({ listingId: "lh", pageViews: 0, orderCount: 10 }),
      row({ listingId: "ll", pageViews: 0, orderCount: 0 }),
    ]);

    const byId = Object.fromEntries(result.rows.map((r) => [r.listingId, r.quadrant]));
    expect(byId.hh).toBe("high_traffic_high_sales");
    expect(byId.hl).toBe("high_traffic_low_sales");
    expect(byId.lh).toBe("low_traffic_high_sales");
    expect(byId.ll).toBe("low_traffic_low_sales");
  });
});

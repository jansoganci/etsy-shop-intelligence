import { describe, expect, it } from "vitest";
import { validateMonthlyStats } from "./_validation";

function validPayload() {
  return {
    month: "2026-06",
    currency: "USD",
    visits: 1000,
    orders: 20,
    conversionRate: 2,
    revenue: 218.81,
    itemFavorites: 140,
    shopFollows: 18,
    reviews: 12,
    repeatBuyers: 4,
    citiesReached: 32,
    abandonedCarts: 21,
    trafficSources: {
      etsy_app_and_other_pages: { visits: 200, sharePercent: 20 },
      etsy_search: { visits: 400, sharePercent: 40 },
      etsy_marketing_and_seo: { visits: 100, sharePercent: 10 },
      direct_and_other_traffic: { visits: 200, sharePercent: 20 },
      social_media: { visits: 100, sharePercent: 10 },
      etsy_ads: { visits: 0, sharePercent: 0 },
    },
    notes: null,
  };
}

describe("monthly Etsy Stats validation", () => {
  it("normalizes a completed USD month", () => {
    const result = validateMonthlyStats(validPayload(), {
      now: new Date("2026-07-23T12:00:00Z"),
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.normalized).toMatchObject({
      month: "2026-06",
      currency: "USD",
      revenue: 218.81,
    });
  });

  it("rejects the current partial month", () => {
    const payload = { ...validPayload(), month: "2026-07" };
    const result = validateMonthlyStats(payload, {
      now: new Date("2026-07-23T12:00:00Z"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("month must be a completed calendar month.");
  });

  it("rejects a currency other than USD", () => {
    const payload = { ...validPayload(), currency: "TRY" };
    const result = validateMonthlyStats(payload, {
      now: new Date("2026-07-23T12:00:00Z"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("currency must be USD.");
  });

  it("warns when conversion rate does not match orders divided by visits", () => {
    const payload = { ...validPayload(), conversionRate: 4 };
    const result = validateMonthlyStats(payload, {
      now: new Date("2026-07-23T12:00:00Z"),
    });

    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toContain("orders / visits");
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    const payload = { ...validPayload(), revenueTry: 8000 };
    const result = validateMonthlyStats(payload, {
      now: new Date("2026-07-23T12:00:00Z"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unexpected field(s): revenueTry.");
  });
});

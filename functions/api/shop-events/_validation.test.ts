import { describe, expect, it } from "vitest";
import { validateShopEvent } from "./_validation";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventDate: "2026-07-23",
    eventType: "title_change",
    listingId: "1905388695",
    oldValue: "Old title",
    newValue: "New title",
    discountRate: null,
    dateFrom: null,
    dateTo: null,
    note: null,
    ...overrides,
  };
}

describe("validateShopEvent", () => {
  it("accepts a well-formed listing event", () => {
    const result = validateShopEvent(validPayload());

    expect(result.valid).toBe(true);
    expect(result.normalized?.eventType).toBe("title_change");
  });

  it("accepts a manual note without a listingId", () => {
    const result = validateShopEvent(
      validPayload({ eventType: "manual_note", listingId: null, note: "General note" }),
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("rejects an invalid eventType", () => {
    const result = validateShopEvent(validPayload({ eventType: "made_up_type" }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("eventType"))).toBe(true);
  });

  it("rejects a malformed eventDate", () => {
    const result = validateShopEvent(validPayload({ eventDate: "23-07-2026" }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("eventDate must use YYYY-MM-DD format.");
  });

  it("requires discountRate for discount_start", () => {
    const result = validateShopEvent(
      validPayload({ eventType: "discount_start", dateFrom: "2026-07-01", dateTo: "2026-07-10" }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("discount_start requires discountRate.");
  });

  it("accepts a discount_start with rate and date range", () => {
    const result = validateShopEvent(
      validPayload({
        eventType: "discount_start",
        discountRate: 30,
        dateFrom: "2026-07-01",
        dateTo: "2026-07-10",
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.normalized?.discountRate).toBe(30);
  });

  it("rejects a discountRate above 100", () => {
    const result = validateShopEvent(
      validPayload({ eventType: "discount_start", discountRate: 150 }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("discountRate must be a number between 0 and 100.");
  });

  it("rejects dateFrom after dateTo", () => {
    const result = validateShopEvent(
      validPayload({
        eventType: "discount_start",
        discountRate: 30,
        dateFrom: "2026-07-20",
        dateTo: "2026-07-10",
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("dateFrom must not be after dateTo.");
  });

  it("warns when a listing-scoped event has no listingId", () => {
    const result = validateShopEvent(validPayload({ listingId: null }));

    expect(result.valid).toBe(true);
    expect(result.warnings.some((message) => message.includes("title_change"))).toBe(true);
  });

  it("rejects unexpected top-level fields", () => {
    const result = validateShopEvent(validPayload({ extra: true }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("extra"))).toBe(true);
  });
});

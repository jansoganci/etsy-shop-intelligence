import { describe, expect, it } from "vitest";
import { extractListingIdFromPagePath } from "./_pagePathParser";

describe("extractListingIdFromPagePath", () => {
  it("extracts the listing id with a slug", () => {
    expect(extractListingIdFromPagePath("/listing/123456789/crochet-pattern")).toBe("123456789");
  });

  it("extracts the listing id without a slug", () => {
    expect(extractListingIdFromPagePath("/listing/123456789")).toBe("123456789");
  });

  it("extracts the listing id with a query string", () => {
    expect(extractListingIdFromPagePath("/listing/123456789?ref=shop_home_active_1")).toBe(
      "123456789",
    );
  });

  it("extracts the listing id with a hash fragment", () => {
    expect(extractListingIdFromPagePath("/listing/123456789#reviews")).toBe("123456789");
  });

  it("trims surrounding whitespace", () => {
    expect(extractListingIdFromPagePath("  /listing/123456789/example  ")).toBe("123456789");
  });

  it("extracts the listing id from a locale-prefixed path (real GA data format)", () => {
    expect(extractListingIdFromPagePath("/de/listing/1854461694/bloom-breeze-hakelanleitung")).toBe(
      "1854461694",
    );
    expect(extractListingIdFromPagePath("/uk/listing/1856557081/boho-lace-crochet-top-pattern")).toBe(
      "1856557081",
    );
    expect(extractListingIdFromPagePath("/fr/listing/1884814795")).toBe("1884814795");
  });

  it("returns null for the shop home page", () => {
    expect(extractListingIdFromPagePath("/")).toBeNull();
  });

  it("returns null for non-listing pages", () => {
    expect(extractListingIdFromPagePath("/shop/YourShopSlug")).toBeNull();
    expect(extractListingIdFromPagePath("/cart")).toBeNull();
    expect(extractListingIdFromPagePath("/favorites")).toBeNull();
  });

  it("returns null for an empty or whitespace-only string", () => {
    expect(extractListingIdFromPagePath("")).toBeNull();
    expect(extractListingIdFromPagePath("   ")).toBeNull();
  });

  it("returns null for a listing path with a non-numeric id", () => {
    expect(extractListingIdFromPagePath("/listing/abc123/example")).toBeNull();
  });
});

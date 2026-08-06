import { describe, expect, it } from "vitest";
import { validateListing } from "./_validation";

const NOW = new Date("2026-07-23T12:00:00Z");

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    listingId: "1905388695",
    url: "https://www.etsy.com/listing/1905388695/filet-mesh-crochet-top-pattern",
    title: "Filet Mesh Crochet Top Pattern Digital PDF XS-XL",
    tags: ["mesh crochet pattern", "easy crochet pattern", "fishnet crochet top"],
    description: "Transform your summer wardrobe with this stunning long-sleeve top.",
    imageAltTexts: ["Back view of a handmade crochet fishnet blouse."],
    price: 9.4,
    currency: "USD",
    status: "active",
    effectiveAt: "2026-07-23",
    changeNote: null,
    ...overrides,
  };
}

describe("validateListing", () => {
  it("accepts a well-formed payload", () => {
    const result = validateListing(validPayload(), { now: NOW });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.normalized?.listingId).toBe("1905388695");
  });

  it("rejects a non-object payload", () => {
    const result = validateListing("nope", { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });

  it("rejects unexpected top-level fields", () => {
    const result = validateListing(validPayload({ salePrice: 5 }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("salePrice"))).toBe(true);
  });

  it("rejects a non-public (editor) url", () => {
    const result = validateListing(
      validPayload({ url: "https://www.etsy.com/your/shops/me/listing-editor/edit/1905388695" }),
      { now: NOW },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("public Etsy listing URL"))).toBe(true);
  });

  it("rejects a listingId that does not match the url", () => {
    const result = validateListing(validPayload({ listingId: "111" }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("must match the numeric id"))).toBe(
      true,
    );
  });

  it("rejects a title longer than 140 characters", () => {
    const result = validateListing(validPayload({ title: "x".repeat(141) }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("title must be at most 140 characters.");
  });

  it("rejects more than 13 tags", () => {
    const tags = Array.from({ length: 14 }, (_, index) => `tag${index}`);
    const result = validateListing(validPayload({ tags }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("tags must contain at most 13 entries.");
  });

  it("rejects a tag longer than 20 characters", () => {
    const result = validateListing(
      validPayload({ tags: ["this tag is definitely too long"] }),
      { now: NOW },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("exceeds 20 characters"))).toBe(true);
  });

  it("rejects a description longer than 20000 characters", () => {
    const result = validateListing(
      validPayload({ description: "x".repeat(20001) }),
      { now: NOW },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("description must be at most 20000 characters.");
  });

  it("warns when no alt texts are provided", () => {
    const result = validateListing(validPayload({ imageAltTexts: [] }), { now: NOW });

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("No image alt texts were provided.");
  });

  it("rejects a negative price", () => {
    const result = validateListing(validPayload({ price: -1 }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("price must be a non-negative number.");
  });

  it("rejects a currency other than USD", () => {
    const result = validateListing(validPayload({ currency: "EUR" }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("currency must be USD.");
  });

  it("rejects an invalid status", () => {
    const result = validateListing(validPayload({ status: "draft" }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('status must be "active" or "inactive".');
  });

  it("rejects a future effectiveAt", () => {
    const result = validateListing(validPayload({ effectiveAt: "2026-08-01" }), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("effectiveAt cannot be in the future.");
  });

  it("rejects a listingId that does not match the URL path segment", () => {
    const result = validateListing(
      validPayload({ listingId: "1905388695" }),
      { now: NOW, expectedListingId: "999" },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("listingId must match the URL listingId 999.");
  });
});

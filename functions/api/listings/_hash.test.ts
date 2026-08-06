import { describe, expect, it } from "vitest";
import { computeContentHash } from "./_hash";

function fields(overrides: Partial<Parameters<typeof computeContentHash>[0]> = {}) {
  return {
    title: "Crochet Blouse Pattern",
    tags: ["crochet", "pdf pattern"],
    description: "A lovely pattern.",
    imageAltTexts: ["front view"],
    price: 8.5,
    status: "active" as const,
    ...overrides,
  };
}

describe("computeContentHash", () => {
  it("is stable for identical content", () => {
    expect(computeContentHash(fields())).toBe(computeContentHash(fields()));
  });

  it("changes when the title changes", () => {
    expect(computeContentHash(fields())).not.toBe(
      computeContentHash(fields({ title: "Crochet Blouse Pattern v2" })),
    );
  });

  it("changes when the price changes", () => {
    expect(computeContentHash(fields())).not.toBe(computeContentHash(fields({ price: 9.5 })));
  });

  it("changes when tags change", () => {
    expect(computeContentHash(fields())).not.toBe(
      computeContentHash(fields({ tags: ["crochet"] })),
    );
  });

  it("changes when status changes", () => {
    expect(computeContentHash(fields())).not.toBe(
      computeContentHash(fields({ status: "inactive" })),
    );
  });
});

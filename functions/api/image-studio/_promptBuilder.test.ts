import { describe, expect, it } from "vitest";
import { buildImageStudioPrompt } from "./_promptBuilder";

const FIXED_SECTION_MARKERS = [
  "expert product photo editor",
  "main reference image is authoritative",
  "stitch pattern, texture, proportions",
  "If the main reference image contains a person",
  "supporting views of the same product",
];

const TRAILING_SECTION_MARKERS = [
  "crop-safe space",
  "preservation rules always take precedence",
];

describe("buildImageStudioPrompt", () => {
  it("includes the fixed preservation sections before the user prompt, in order", () => {
    const prompt = buildImageStudioPrompt({ userPrompt: "place it on a marble countertop" });
    const indexes = FIXED_SECTION_MARKERS.map((marker) => prompt.indexOf(marker));

    for (const index of indexes) {
      expect(index).toBeGreaterThanOrEqual(0);
    }

    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]);
    }
  });

  it("includes the fixed composition and conflict sections after the user prompt, in order", () => {
    const prompt = buildImageStudioPrompt({ userPrompt: "place it on a marble countertop" });
    const userPromptIndex = prompt.indexOf("place it on a marble countertop");
    const indexes = TRAILING_SECTION_MARKERS.map((marker) => prompt.indexOf(marker));

    expect(indexes[0]).toBeGreaterThan(userPromptIndex);

    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]);
    }
  });

  it("always includes the permanent preservation rules regardless of input", () => {
    const prompt = buildImageStudioPrompt({ userPrompt: "anything" });

    expect(prompt).toContain("Do not redesign, simplify, recolor, restyle, or replace it.");
  });

  it("always includes the conditional person-preservation clause verbatim", () => {
    const prompt = buildImageStudioPrompt({ userPrompt: "anything" });

    expect(prompt).toContain(
      "If the main reference image contains a person, preserve the same identity, face, "
      + "body, and recognizable physical characteristics exactly as shown; if it does not "
      + "contain a person, this instruction does not apply.",
    );
  });

  it("passes the user's prompt through verbatim, without wrapping or labeling it", () => {
    const prompt = buildImageStudioPrompt({
      userPrompt: "Place this item on a sunlit windowsill next to a small potted plant.",
    });

    expect(prompt).toContain("Place this item on a sunlit windowsill next to a small potted plant.");
    expect(prompt).not.toContain("Scene:");
    expect(prompt).not.toContain("Additional instructions:");
  });

  it("trims surrounding whitespace from the user's prompt", () => {
    const prompt = buildImageStudioPrompt({ userPrompt: "  a tidy studio backdrop  " });

    expect(prompt).toContain("\n\na tidy studio backdrop\n\n");
  });

  it("ends with the conflict rule", () => {
    const prompt = buildImageStudioPrompt({ userPrompt: "add plants" });

    expect(prompt.trimEnd().endsWith("preservation rules always take precedence.")).toBe(true);
  });
});

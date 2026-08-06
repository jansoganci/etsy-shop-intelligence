import { describe, expect, it } from "vitest";
import { mapToGptImage2EditInput, mapToNanoBananaEditInput } from "./_falMappers";

function makeImageFile(name: string): File {
  return new File([new Uint8Array(4)], name, { type: "image/jpeg" });
}

describe("mapToNanoBananaEditInput", () => {
  it("returns exactly the fields specified for the shared Nano Banana mapper", () => {
    const images = [makeImageFile("main.jpg"), makeImageFile("ref.jpg")];
    const result = mapToNanoBananaEditInput({ prompt: "a prompt", images, aspectRatio: "1:1" });

    expect(result).toEqual({
      prompt: "a prompt",
      image_urls: images,
      aspect_ratio: "1:1",
      num_images: 1,
      resolution: "1K",
      output_format: "jpeg",
      limit_generations: true,
    });
  });

  it("never exposes optional model controls outside V1 scope", () => {
    const result = mapToNanoBananaEditInput({ prompt: "a prompt", images: [], aspectRatio: "1:1" });

    for (const field of ["seed", "safety_tolerance", "sync_mode", "system_prompt", "enable_web_search", "thinking_level"]) {
      expect(result).not.toHaveProperty(field);
    }
  });
});

describe("mapToGptImage2EditInput", () => {
  it("returns exactly the fields specified for the GPT Image 2 mapper", () => {
    const images = [makeImageFile("main.jpg")];
    const result = mapToGptImage2EditInput({ prompt: "a prompt", images, aspectRatio: "1:1" });

    expect(result).toEqual({
      prompt: "a prompt",
      image_urls: images,
      image_size: "square_hd",
      quality: "high",
      num_images: 1,
      output_format: "jpeg",
    });
  });

  it("never exposes resolution or other fields the Nano Banana mapper has", () => {
    const result = mapToGptImage2EditInput({ prompt: "a prompt", images: [], aspectRatio: "1:1" });

    for (const field of ["resolution", "limit_generations", "aspect_ratio", "sync_mode"]) {
      expect(result).not.toHaveProperty(field);
    }
  });
});

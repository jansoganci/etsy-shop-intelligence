import { describe, expect, it } from "vitest";
import { ImageStudioValidationError, parseAndValidateGenerateRequest } from "./_validation";

function makeImageFile(name: string, sizeBytes: number, type = "image/jpeg"): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

function baseFormData(overrides: Record<string, string | Blob | undefined> = {}): FormData {
  const formData = new FormData();
  formData.set("mainImage", makeImageFile("main.jpg", 1024));
  formData.set("prompt", "place this item on a marble countertop, morning light");
  formData.set("modelId", "fal-ai/nano-banana-2/edit");
  formData.set("aspectRatio", "1:1");
  formData.set("resolution", "1K");
  formData.set("outputFormat", "jpeg");

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      formData.delete(key);
    } else {
      formData.set(key, value);
    }
  }

  return formData;
}

describe("parseAndValidateGenerateRequest", () => {
  it("throws when the main image is missing", () => {
    const formData = baseFormData({ mainImage: undefined });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when more than 3 supporting images are provided", () => {
    const formData = baseFormData();

    for (let i = 0; i < 4; i += 1) {
      formData.append("referenceImages", makeImageFile(`ref-${i}.jpg`, 1024));
    }

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when a file has a disallowed type", () => {
    const formData = baseFormData({ mainImage: makeImageFile("main.txt", 1024, "text/plain") });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when a file exceeds the per-file size limit", () => {
    const formData = baseFormData({ mainImage: makeImageFile("main.jpg", 11 * 1024 * 1024) });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when combined file size exceeds the total limit", () => {
    const formData = baseFormData({ mainImage: makeImageFile("main.jpg", 6 * 1024 * 1024) });

    for (let i = 0; i < 3; i += 1) {
      formData.append("referenceImages", makeImageFile(`ref-${i}.jpg`, 7 * 1024 * 1024));
    }

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the prompt is missing", () => {
    const formData = baseFormData({ prompt: undefined });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the prompt is only whitespace", () => {
    const formData = baseFormData({ prompt: "   " });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the prompt exceeds the max length", () => {
    const formData = baseFormData({ prompt: "a".repeat(6001) });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the model id is not allowlisted", () => {
    const formData = baseFormData({ modelId: "some-other-model" });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the aspect ratio is not supported", () => {
    const formData = baseFormData({ aspectRatio: "16:9" });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the resolution is not supported", () => {
    const formData = baseFormData({ resolution: "4K" });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("throws when the output format is not supported", () => {
    const formData = baseFormData({ outputFormat: "png" });

    expect(() => parseAndValidateGenerateRequest(formData)).toThrow(ImageStudioValidationError);
  });

  it("returns a fully-typed result for a valid request", () => {
    const formData = baseFormData();
    formData.append("referenceImages", makeImageFile("ref-0.jpg", 1024));

    const result = parseAndValidateGenerateRequest(formData);

    expect(result.mainImage).toBeInstanceOf(File);
    expect(result.referenceImages).toHaveLength(1);
    expect(result.prompt).toBe("place this item on a marble countertop, morning light");
    expect(result.modelId).toBe("fal-ai/nano-banana-2/edit");
    expect(result.aspectRatio).toBe("1:1");
    expect(result.resolution).toBe("1K");
    expect(result.outputFormat).toBe("jpeg");
  });

  it("trims surrounding whitespace from the prompt", () => {
    const formData = baseFormData({ prompt: "  sunlit studio backdrop  " });

    const result = parseAndValidateGenerateRequest(formData);

    expect(result.prompt).toBe("sunlit studio backdrop");
  });
});

import {
  IMAGE_STUDIO_ASPECT_RATIOS,
  IMAGE_STUDIO_LIMITS,
  IMAGE_STUDIO_MODELS,
  IMAGE_STUDIO_OUTPUT_FORMATS,
  IMAGE_STUDIO_RESOLUTIONS,
} from "./_constants";

export type ImageStudioModelId = (typeof IMAGE_STUDIO_MODELS)[number]["id"];
export type ImageStudioAspectRatio = (typeof IMAGE_STUDIO_ASPECT_RATIOS)[number];
export type ImageStudioResolution = (typeof IMAGE_STUDIO_RESOLUTIONS)[number];
export type ImageStudioOutputFormat = (typeof IMAGE_STUDIO_OUTPUT_FORMATS)[number];

export type ValidatedGenerateRequest = {
  mainImage: File;
  referenceImages: File[];
  prompt: string;
  modelId: ImageStudioModelId;
  aspectRatio: ImageStudioAspectRatio;
  resolution: ImageStudioResolution;
  outputFormat: ImageStudioOutputFormat;
};

export class ImageStudioValidationError extends Error {}

function validateImageFile(file: File, fieldLabel: string): void {
  const hasAllowedType = (IMAGE_STUDIO_LIMITS.allowedMimeTypes as readonly string[]).includes(file.type)
    || /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!hasAllowedType) {
    throw new ImageStudioValidationError(`${fieldLabel}: only JPG, PNG, or WebP files are supported.`);
  }

  if (file.size > IMAGE_STUDIO_LIMITS.maxFileSizeBytes) {
    const maxMb = Math.round(IMAGE_STUDIO_LIMITS.maxFileSizeBytes / (1024 * 1024));
    throw new ImageStudioValidationError(`${fieldLabel}: file is larger than ${maxMb} MB.`);
  }
}

export function parseAndValidateGenerateRequest(formData: FormData): ValidatedGenerateRequest {
  const mainImage = formData.get("mainImage");

  if (!(mainImage instanceof File)) {
    throw new ImageStudioValidationError("A main reference image is required.");
  }

  validateImageFile(mainImage, "Main image");

  const referenceImages = formData.getAll("referenceImages").filter((value): value is File => value instanceof File);

  if (referenceImages.length > IMAGE_STUDIO_LIMITS.maxSupportingImages) {
    throw new ImageStudioValidationError(
      `No more than ${IMAGE_STUDIO_LIMITS.maxSupportingImages} supporting images are allowed.`,
    );
  }

  for (const [index, file] of referenceImages.entries()) {
    validateImageFile(file, `Supporting image ${index + 1}`);
  }

  const combinedSize = mainImage.size + referenceImages.reduce((total, file) => total + file.size, 0);

  if (combinedSize > IMAGE_STUDIO_LIMITS.maxTotalSizeBytes) {
    const maxTotalMb = Math.round(IMAGE_STUDIO_LIMITS.maxTotalSizeBytes / (1024 * 1024));
    throw new ImageStudioValidationError(`Reference images exceed the ${maxTotalMb} MB combined limit.`);
  }

  const promptValue = formData.get("prompt");
  const prompt = typeof promptValue === "string" ? promptValue.trim() : "";

  if (!prompt) {
    throw new ImageStudioValidationError("A prompt is required.");
  }

  if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptLength) {
    throw new ImageStudioValidationError(
      `Prompt must be ${IMAGE_STUDIO_LIMITS.maxPromptLength} characters or fewer.`,
    );
  }

  const modelIdValue = formData.get("modelId");
  const modelId = IMAGE_STUDIO_MODELS.find((model) => model.id === modelIdValue)?.id;

  if (!modelId) {
    throw new ImageStudioValidationError("The selected model is not recognized.");
  }

  const aspectRatioValue = formData.get("aspectRatio");
  const aspectRatio = IMAGE_STUDIO_ASPECT_RATIOS.find((value) => value === aspectRatioValue);

  if (!aspectRatio) {
    throw new ImageStudioValidationError("The selected aspect ratio is not supported.");
  }

  const resolutionValue = formData.get("resolution");
  const resolution = IMAGE_STUDIO_RESOLUTIONS.find((value) => value === resolutionValue);

  if (!resolution) {
    throw new ImageStudioValidationError("The selected resolution is not supported.");
  }

  const outputFormatValue = formData.get("outputFormat");
  const outputFormat = IMAGE_STUDIO_OUTPUT_FORMATS.find((value) => value === outputFormatValue);

  if (!outputFormat) {
    throw new ImageStudioValidationError("The selected output format is not supported.");
  }

  return {
    mainImage,
    referenceImages,
    prompt,
    modelId,
    aspectRatio,
    resolution,
    outputFormat,
  };
}

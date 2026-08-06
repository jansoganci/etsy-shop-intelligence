import type { ImageStudioLimits } from "../../data/types/imageStudio";

type ValidationResult = { ok: true } | { ok: false; message: string };

const EXTENSION_PATTERN = /\.(jpe?g|png|webp)$/i;

export function validateReferenceImage(
  file: File,
  existingFiles: File[],
  limits: ImageStudioLimits,
): ValidationResult {
  const hasAllowedType = limits.allowedMimeTypes.includes(file.type) || EXTENSION_PATTERN.test(file.name);

  if (!hasAllowedType) {
    return { ok: false, message: "Only JPG, PNG, or WebP files are supported." };
  }

  if (file.size > limits.maxFileSizeBytes) {
    const maxMb = Math.round(limits.maxFileSizeBytes / (1024 * 1024));
    return { ok: false, message: `File is larger than ${maxMb} MB. Choose a smaller image.` };
  }

  const combinedSize = existingFiles.reduce((total, existing) => total + existing.size, 0) + file.size;

  if (combinedSize > limits.maxTotalSizeBytes) {
    const maxTotalMb = Math.round(limits.maxTotalSizeBytes / (1024 * 1024));
    return {
      ok: false,
      message: `Adding this file would exceed the ${maxTotalMb} MB combined limit for all reference images.`,
    };
  }

  return { ok: true };
}

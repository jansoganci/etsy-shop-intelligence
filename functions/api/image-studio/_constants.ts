export const IMAGE_STUDIO_MODELS = [
  {
    id: "fal-ai/nano-banana-2/edit",
    name: "Nano Banana 2",
    provider: "fal.ai",
    description: "Fast and balanced — a good default for most listing photos.",
  },
  {
    id: "openai/gpt-image-2/edit",
    name: "GPT Image 2",
    provider: "fal.ai",
    description: "Strong with fine detail and text in the scene.",
  },
  {
    id: "fal-ai/nano-banana-pro/edit",
    name: "Nano Banana Pro",
    provider: "fal.ai",
    description: "Highest quality, takes a little longer to generate.",
  },
] as const;

export const IMAGE_STUDIO_ASPECT_RATIOS = ["1:1"] as const;
export const IMAGE_STUDIO_RESOLUTIONS = ["1K"] as const;
export const IMAGE_STUDIO_OUTPUT_FORMATS = ["jpeg"] as const;

export const IMAGE_STUDIO_LIMITS = {
  maxSupportingImages: 3,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxTotalSizeBytes: 25 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  // Sized for a full professional prompt, not a short note.
  maxPromptLength: 6000,
} as const;

import type { ImageStudioAspectRatio } from "./_validation";

export type FalMapperParams = {
  prompt: string;
  images: File[];
  aspectRatio: ImageStudioAspectRatio;
};

export type NanoBananaEditInput = {
  prompt: string;
  image_urls: File[];
  aspect_ratio: ImageStudioAspectRatio;
  num_images: 1;
  resolution: "1K";
  output_format: "jpeg";
  limit_generations: true;
};

export type GptImage2EditInput = {
  prompt: string;
  image_urls: File[];
  image_size: "square_hd";
  quality: "high";
  num_images: 1;
  output_format: "jpeg";
};

// Shared by fal-ai/nano-banana-2/edit and fal-ai/nano-banana-pro/edit per spec.
// Deliberately excludes seed/safety/sync/system-prompt/web-search/thinking/
// video/audio/PDF/2K/4K controls that both models otherwise support.
export function mapToNanoBananaEditInput({ prompt, images, aspectRatio }: FalMapperParams): NanoBananaEditInput {
  return {
    prompt,
    image_urls: images,
    aspect_ratio: aspectRatio,
    num_images: 1,
    resolution: "1K",
    output_format: "jpeg",
    limit_generations: true,
  };
}

// V1 only ever validates aspectRatio as "1:1", which maps to GPT Image 2's
// "square_hd" high-quality square size. Additional ratio mappings can be
// added here when more aspect ratios are enabled in _constants.ts.
const GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO: Record<ImageStudioAspectRatio, GptImage2EditInput["image_size"]> = {
  "1:1": "square_hd",
};

// Deliberately excludes resolution, masks, sync mode, custom OpenAI keys,
// usage metadata, and streaming, none of which GPT Image 2 Edit gets in V1.
export function mapToGptImage2EditInput({ prompt, images, aspectRatio }: FalMapperParams): GptImage2EditInput {
  return {
    prompt,
    image_urls: images,
    image_size: GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO[aspectRatio],
    quality: "high",
    num_images: 1,
    output_format: "jpeg",
  };
}

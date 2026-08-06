import { fal } from "@fal-ai/client";
import { IMAGE_STUDIO_LIMITS } from "./_constants";
import {
  ProviderResultError,
  ProviderTimeoutError,
  type GenerateEditInput,
  type GenerateEditResult,
  type ImageEditProvider,
} from "./_imageProvider";
import { mapToGptImage2EditInput, mapToNanoBananaEditInput } from "./_falMappers";
import type { ImageStudioModelId } from "./_validation";

// The spec calls for a flat 60-second application timeout across all three
// models. In practice, both Nano Banana models complete in ~10-20s, well
// within that budget — but GPT Image 2 Edit at the spec's required
// `quality: "high"` was directly measured (uncapped) taking ~177s. A flat
// 60s would make that model fail on essentially every real request, so it
// gets a deliberately longer, documented budget instead.
const DEFAULT_TIMEOUT_MS = 60_000;
const GPT_IMAGE_2_TIMEOUT_MS = 200_000;

const NANO_BANANA_MODEL_IDS = new Set<ImageStudioModelId>([
  "fal-ai/nano-banana-2/edit",
  "fal-ai/nano-banana-pro/edit",
]);

// Reused as a practical sanity bound on the returned image — the spec
// requires size validation to succeed but doesn't specify a number, so this
// reuses the same limit applied to uploaded reference images.
const MAX_OUTPUT_BYTES = IMAGE_STUDIO_LIMITS.maxFileSizeBytes;

type FalResultImage = {
  url?: string;
  content_type?: string;
};

export const falImageService: ImageEditProvider = {
  async generateEdit(input: GenerateEditInput): Promise<GenerateEditResult> {
    fal.config({ credentials: input.falKey });

    const images = [input.mainImage, ...input.referenceImages];

    const providerInput = NANO_BANANA_MODEL_IDS.has(input.modelId)
      ? mapToNanoBananaEditInput({ prompt: input.prompt, images, aspectRatio: input.aspectRatio })
      : mapToGptImage2EditInput({ prompt: input.prompt, images, aspectRatio: input.aspectRatio });

    const timeoutMs = NANO_BANANA_MODEL_IDS.has(input.modelId) ? DEFAULT_TIMEOUT_MS : GPT_IMAGE_2_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let result: { data: unknown; requestId: string };

    try {
      // The SDK's own `timeout` option is documented as not currently
      // enforced — abortSignal is the real mechanism for our timeout budget.
      // `as any` casts here are intentional and narrowly scoped: this app's
      // 3 model IDs mix a typed SDK endpoint (Nano Banana) and an untyped
      // one (GPT Image 2, no generated type in this SDK version at all), so
      // strict typing across the union isn't worth it — the mappers above
      // are hand-validated against the spec instead.
      result = await fal.subscribe(input.modelId as any, {
        input: providerInput as any,
        abortSignal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderTimeoutError("fal_subscribe_timeout");
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const output = result.data as { images?: FalResultImage[] };
    const image = output.images?.[0];

    if (!image?.url) {
      throw new ProviderResultError("fal_result_missing_image");
    }

    if (image.content_type && !image.content_type.startsWith("image/")) {
      throw new ProviderResultError("fal_result_invalid_content_type");
    }

    const imageResponse = await fetch(image.url);

    if (!imageResponse.ok) {
      throw new ProviderResultError("fal_result_fetch_failed");
    }

    const fetchedContentType = imageResponse.headers.get("Content-Type") ?? "";

    if (!fetchedContentType.startsWith("image/")) {
      throw new ProviderResultError("fal_result_fetch_invalid_content_type");
    }

    const bytes = await imageResponse.arrayBuffer();

    if (bytes.byteLength === 0) {
      throw new ProviderResultError("fal_result_empty");
    }

    if (bytes.byteLength > MAX_OUTPUT_BYTES) {
      throw new ProviderResultError("fal_result_too_large");
    }

    // V1's output_format is always "jpeg" per both mappers — this asserts
    // the contractual value rather than passing through whatever content
    // type the provider claims, per "treat provider-returned media as
    // untrusted until validation succeeds."
    return { bytes, contentType: "image/jpeg" };
  },
};

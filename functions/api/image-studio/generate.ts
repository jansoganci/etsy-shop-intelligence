import { ApiError } from "@fal-ai/client";
import { buildImageStudioPrompt } from "./_promptBuilder";
import { ImageStudioValidationError, parseAndValidateGenerateRequest } from "./_validation";
import { falImageService } from "./_falImageService";
import { ProviderResultError, ProviderTimeoutError } from "./_imageProvider";
import { releaseGenerationSlot, tryAcquireGenerationSlot } from "./_concurrencyGuard";

interface Env {
  FAL_KEY: string;
}

type ImageStudioErrorCode =
  | "invalid_input"
  | "concurrent_request"
  | "provider_timeout"
  | "provider_failure"
  | "unexpected_failure";

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function jsonFailure(
  status: number,
  error: ImageStudioErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { ok: false, error, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

type ErrorClassification = {
  status: number;
  error: ImageStudioErrorCode;
  message: string;
  logDetail: string;
};

// `logDetail` is always a short, hand-picked, safe string — never the raw
// error object, provider response body, prompt, or file data. Per spec:
// never log prompts, source images, generated image bytes, credentials, or
// full provider responses.
function classifyGenerateError(error: unknown): ErrorClassification {
  if (error instanceof ImageStudioValidationError) {
    return { status: 400, error: "invalid_input", message: error.message, logDetail: error.message };
  }

  if (error instanceof ProviderTimeoutError) {
    return {
      status: 504,
      error: "provider_timeout",
      message: "The request took too long and was cancelled. Please try again.",
      logDetail: "provider_timeout",
    };
  }

  if (error instanceof ApiError) {
    const detail = error.body?.detail;
    const types = Array.isArray(detail)
      ? detail.map((entry: { type?: string }) => entry.type).filter(Boolean).join(",")
      : "";

    return {
      status: 502,
      error: "provider_failure",
      message: "The image provider failed to generate an image. Please try again or adjust your scene or instructions.",
      logDetail: types ? `fal_status_${error.status}:${types}` : `fal_status_${error.status}`,
    };
  }

  if (error instanceof ProviderResultError) {
    return {
      status: 502,
      error: "provider_failure",
      message: "The image provider failed to generate an image. Please try again or adjust your scene or instructions.",
      logDetail: error.message,
    };
  }

  return {
    status: 500,
    error: "unexpected_failure",
    message: "Image generation failed unexpectedly. Please try again.",
    logDetail: error instanceof Error ? error.name : typeof error,
  };
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const startedAt = Date.now();

  if (!tryAcquireGenerationSlot()) {
    return jsonFailure(
      409,
      "concurrent_request",
      "Another image generation is already in progress. Please wait for it to finish.",
    );
  }

  try {
    const formData = await request.formData();
    const validated = parseAndValidateGenerateRequest(formData);

    const prompt = buildImageStudioPrompt({ userPrompt: validated.prompt });

    const result = await falImageService.generateEdit({
      modelId: validated.modelId,
      prompt,
      mainImage: validated.mainImage,
      referenceImages: validated.referenceImages,
      aspectRatio: validated.aspectRatio,
      resolution: validated.resolution,
      outputFormat: validated.outputFormat,
      falKey: env.FAL_KEY,
    });

    console.log("image_studio_generate_succeeded", {
      durationMs: Date.now() - startedAt,
      modelId: validated.modelId,
    });

    return new Response(result.bytes, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
        "X-Image-Model": validated.modelId,
      },
    });
  } catch (error) {
    const failure = classifyGenerateError(error);

    console.error("image_studio_generate_failed", {
      durationMs: Date.now() - startedAt,
      code: failure.error,
      detail: failure.logDetail,
    });

    const hostname = new URL(request.url).hostname;
    const includeDetail = isLocalHostname(hostname);

    return jsonFailure(
      failure.status,
      failure.error,
      failure.message,
      includeDetail ? { detail: failure.logDetail } : undefined,
    );
  } finally {
    releaseGenerationSlot();
  }
}

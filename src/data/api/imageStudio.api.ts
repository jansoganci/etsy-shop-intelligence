import type {
  ImageStudioConfigResponse,
  ImageStudioErrorCode,
  ImageStudioGenerateFailure,
  ImageStudioGenerateRequest,
  ImageStudioGenerateSuccess,
} from "../types/imageStudio";

// Must exceed the backend's longest per-model timeout budget (see
// functions/api/image-studio/_falImageService.ts — GPT Image 2 Edit runs
// with a 200s server-side budget since it was directly measured taking
// ~177s), plus a buffer, so the client never times out a request the server
// is still legitimately processing.
const GENERATE_TIMEOUT_MS = 210_000;

export class ImageStudioGenerateError extends Error {
  code: ImageStudioErrorCode;

  constructor(failure: ImageStudioGenerateFailure) {
    super(failure.message);
    this.name = "ImageStudioGenerateError";
    this.code = failure.error;
  }
}

export async function getImageStudioConfig(): Promise<ImageStudioConfigResponse> {
  let response: Response;

  try {
    response = await fetch("/api/image-studio/config");
  } catch {
    throw new Error("Network error while loading Image Studio configuration.");
  }

  let data: ImageStudioConfigResponse | { ok: false };

  try {
    data = (await response.json()) as ImageStudioConfigResponse | { ok: false };
  } catch {
    throw new Error("Image Studio configuration API returned an invalid response.");
  }

  if (!response.ok || data.ok !== true) {
    throw new Error("Failed to load Image Studio configuration.");
  }

  return data;
}

function buildGenerateFormData(request: ImageStudioGenerateRequest): FormData {
  const formData = new FormData();
  formData.append("mainImage", request.mainImage);

  for (const file of request.referenceImages) {
    formData.append("referenceImages", file);
  }

  formData.append("prompt", request.prompt);
  formData.append("modelId", request.modelId);
  formData.append("aspectRatio", request.aspectRatio);
  formData.append("resolution", request.resolution);
  formData.append("outputFormat", request.outputFormat);

  return formData;
}

export async function generateImageStudioImage(
  request: ImageStudioGenerateRequest,
): Promise<ImageStudioGenerateSuccess> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch("/api/image-studio/generate", {
      method: "POST",
      body: buildGenerateFormData(request),
      signal: controller.signal,
    });
  } catch (fetchError) {
    const isAbort = fetchError instanceof DOMException && fetchError.name === "AbortError";
    throw new ImageStudioGenerateError({
      ok: false,
      error: isAbort ? "provider_timeout" : "unexpected_failure",
      message: isAbort
        ? "The request took too long and was cancelled. Please try again."
        : "Network error while generating the image.",
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get("Content-Type") ?? "";

  if (!response.ok || !contentType.startsWith("image/")) {
    let failure: ImageStudioGenerateFailure;

    try {
      failure = (await response.json()) as ImageStudioGenerateFailure;
    } catch {
      failure = {
        ok: false,
        error: "unexpected_failure",
        message: "Image generation failed with an unexpected response.",
      };
    }

    throw new ImageStudioGenerateError(failure);
  }

  const modelId = response.headers.get("X-Image-Model") ?? request.modelId;
  const blob = await response.blob();

  return {
    ok: true,
    blob,
    objectUrl: URL.createObjectURL(blob),
    modelId,
  };
}

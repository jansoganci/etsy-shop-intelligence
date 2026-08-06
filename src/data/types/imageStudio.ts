export type ImageStudioModelId =
  | "fal-ai/nano-banana-2/edit"
  | "openai/gpt-image-2/edit"
  | "fal-ai/nano-banana-pro/edit";

export interface ImageStudioModel {
  id: ImageStudioModelId;
  name: string;
  provider: "fal.ai";
  description: string;
}

export interface ImageStudioScene {
  id: string;
  label: string;
  description: string;
  promptFragment: string;
}

export type ImageStudioAspectRatio = "1:1";
export type ImageStudioResolution = "1K";
export type ImageStudioOutputFormat = "jpeg";

export interface ImageStudioLimits {
  maxSupportingImages: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  allowedMimeTypes: string[];
  maxPromptLength: number;
}

export interface ImageStudioConfigResponse {
  ok: true;
  models: ImageStudioModel[];
  scenes: ImageStudioScene[];
  aspectRatios: ImageStudioAspectRatio[];
  resolutions: ImageStudioResolution[];
  outputFormats: ImageStudioOutputFormat[];
  limits: ImageStudioLimits;
}

export interface ImageStudioReferenceImage {
  file: File;
  previewUrl: string;
}

export interface ImageStudioFormState {
  mainImage: ImageStudioReferenceImage | null;
  supportingImages: ImageStudioReferenceImage[];
  prompt: string;
  modelId: ImageStudioModelId | "";
  aspectRatio: ImageStudioAspectRatio | "";
  resolution: ImageStudioResolution | "";
  outputFormat: ImageStudioOutputFormat | "";
}

export interface ImageStudioGenerateRequest {
  mainImage: File;
  referenceImages: File[];
  prompt: string;
  modelId: ImageStudioModelId;
  aspectRatio: ImageStudioAspectRatio;
  resolution: ImageStudioResolution;
  outputFormat: ImageStudioOutputFormat;
}

export interface ImageStudioGenerateSuccess {
  ok: true;
  blob: Blob;
  objectUrl: string;
  modelId: string;
}

export type ImageStudioErrorCode =
  | "invalid_input"
  | "concurrent_request"
  | "provider_timeout"
  | "provider_failure"
  | "unexpected_failure";

export interface ImageStudioGenerateFailure {
  ok: false;
  error: ImageStudioErrorCode;
  message: string;
}

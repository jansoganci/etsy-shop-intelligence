import type {
  ImageStudioAspectRatio,
  ImageStudioModelId,
  ImageStudioOutputFormat,
  ImageStudioResolution,
} from "./_validation";

export type GenerateEditInput = {
  modelId: ImageStudioModelId;
  prompt: string;
  mainImage: File;
  referenceImages: File[];
  aspectRatio: ImageStudioAspectRatio;
  resolution: ImageStudioResolution;
  outputFormat: ImageStudioOutputFormat;
  falKey: string;
};

export type GenerateEditResult = {
  bytes: ArrayBuffer;
  contentType: string;
};

export interface ImageEditProvider {
  generateEdit(input: GenerateEditInput): Promise<GenerateEditResult>;
}

export class ProviderTimeoutError extends Error {}
export class ProviderResultError extends Error {}

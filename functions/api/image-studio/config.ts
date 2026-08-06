import {
  IMAGE_STUDIO_ASPECT_RATIOS,
  IMAGE_STUDIO_LIMITS,
  IMAGE_STUDIO_MODELS,
  IMAGE_STUDIO_OUTPUT_FORMATS,
  IMAGE_STUDIO_RESOLUTIONS,
} from "./_constants";
import { IMAGE_STUDIO_SCENES } from "./_scenes";

export async function onRequestGet(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      models: IMAGE_STUDIO_MODELS,
      scenes: IMAGE_STUDIO_SCENES,
      aspectRatios: IMAGE_STUDIO_ASPECT_RATIOS,
      resolutions: IMAGE_STUDIO_RESOLUTIONS,
      outputFormats: IMAGE_STUDIO_OUTPUT_FORMATS,
      limits: IMAGE_STUDIO_LIMITS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

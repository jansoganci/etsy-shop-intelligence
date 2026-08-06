import { useEffect, useMemo, useRef, useState } from "react";
import "../image-studio.css";
import { LoadingState, PageHeader, PageSection } from "../../../components/ui";
import {
  ImageStudioGenerateError,
  generateImageStudioImage,
  getImageStudioConfig,
} from "../../../data/api/imageStudio.api";
import type {
  ImageStudioConfigResponse,
  ImageStudioFormState,
  ImageStudioScene,
} from "../../../data/types/imageStudio";
import {
  GenerationResultPanel,
  OutputSettingsSection,
  PromptEditorSection,
  ReferenceImagesSection,
  ScenePicker,
} from "../components";
import { buildDownloadFilename } from "../filename";

type GenerationResultState = {
  objectUrl: string;
  modelLabel: string;
  downloadFilename: string;
};

function removeFragment(prompt: string, fragment: string): string {
  const withCommaAfter = `${fragment}, `;
  const withCommaBefore = `, ${fragment}`;

  if (prompt === fragment) {
    return "";
  }

  if (prompt.startsWith(withCommaAfter)) {
    return prompt.slice(withCommaAfter.length);
  }

  if (prompt.includes(withCommaBefore)) {
    return prompt.replace(withCommaBefore, "");
  }

  return prompt.includes(fragment) ? prompt.replace(fragment, "").trim() : prompt;
}

const EMPTY_FORM_STATE: ImageStudioFormState = {
  mainImage: null,
  supportingImages: [],
  prompt: "",
  modelId: "",
  aspectRatio: "",
  resolution: "",
  outputFormat: "",
};

const NAVIGATION_WARNING_MESSAGE =
  "An image is still generating. Leaving now will cancel it. Continue anyway?";

export function ImageStudioPage() {
  const [config, setConfig] = useState<ImageStudioConfigResponse | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [form, setForm] = useState<ImageStudioFormState>(EMPTY_FORM_STATE);
  const [activeSceneIds, setActiveSceneIds] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResultState | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const formRef = useRef(form);
  formRef.current = form;
  const resultRef = useRef(result);
  resultRef.current = result;
  const isGeneratingRef = useRef(isGenerating);
  isGeneratingRef.current = isGenerating;

  useEffect(() => {
    let isCancelled = false;

    setIsConfigLoading(true);
    setConfigError(null);

    void getImageStudioConfig()
      .then((response) => {
        if (!isCancelled) {
          setConfig(response);
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setConfigError(
            fetchError instanceof Error ? fetchError.message : "Failed to load Image Studio configuration.",
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsConfigLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config || form.modelId !== "") {
      return;
    }

    setForm((current) => ({
      ...current,
      modelId: config.models[0]?.id ?? "",
      aspectRatio: config.aspectRatios[0] ?? "",
      resolution: config.resolutions[0] ?? "",
      outputFormat: config.outputFormats[0] ?? "",
    }));
  }, [config, form.modelId]);

  useEffect(() => {
    return () => {
      const currentForm = formRef.current;
      const currentResult = resultRef.current;

      if (currentForm.mainImage) {
        URL.revokeObjectURL(currentForm.mainImage.previewUrl);
      }

      for (const image of currentForm.supportingImages) {
        URL.revokeObjectURL(image.previewUrl);
      }

      if (currentResult) {
        URL.revokeObjectURL(currentResult.objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isGeneratingRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!isGeneratingRef.current) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");

      if (!link || link.target === "_blank") {
        return;
      }

      const isInternalNavigation = link.origin === window.location.origin
        && link.pathname !== window.location.pathname;

      if (!isInternalNavigation) {
        return;
      }

      if (!window.confirm(NAVIGATION_WARNING_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  const canSubmit = useMemo(() => {
    if (!config || isGenerating || !form.mainImage) {
      return false;
    }

    if (!form.modelId || !form.aspectRatio || !form.resolution || !form.outputFormat) {
      return false;
    }

    if (form.prompt.trim() === "") {
      return false;
    }

    return true;
  }, [config, isGenerating, form]);

  const disabledReason = useMemo(() => {
    if (!form.mainImage && form.prompt.trim() === "") {
      return "Upload a main image and write a prompt to generate.";
    }

    if (!form.mainImage) {
      return "Upload a main image to generate.";
    }

    if (form.prompt.trim() === "") {
      return "Write a prompt to generate.";
    }

    return null;
  }, [form.mainImage, form.prompt]);

  const handleToggleScene = (scene: ImageStudioScene) => {
    const isActive = activeSceneIds.has(scene.id);

    setForm((current) => {
      if (isActive) {
        return { ...current, prompt: removeFragment(current.prompt, scene.promptFragment) };
      }

      const trimmedPrompt = current.prompt.trim();
      return {
        ...current,
        prompt: trimmedPrompt ? `${trimmedPrompt}, ${scene.promptFragment}` : scene.promptFragment,
      };
    });

    setActiveSceneIds((current) => {
      const next = new Set(current);
      if (isActive) {
        next.delete(scene.id);
      } else {
        next.add(scene.id);
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!canSubmit || !form.mainImage) {
      return;
    }
    if (!form.modelId || !form.aspectRatio || !form.resolution || !form.outputFormat) {
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const response = await generateImageStudioImage({
        mainImage: form.mainImage.file,
        referenceImages: form.supportingImages.map((image) => image.file),
        prompt: form.prompt,
        modelId: form.modelId,
        aspectRatio: form.aspectRatio,
        resolution: form.resolution,
        outputFormat: form.outputFormat,
      });

      const modelLabel = config?.models.find((model) => model.id === response.modelId)?.name
        ?? response.modelId;

      setResult((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous.objectUrl);
        }

        return {
          objectUrl: response.objectUrl,
          modelLabel,
          downloadFilename: buildDownloadFilename(form.prompt, new Date()),
        };
      });
    } catch (error) {
      setGenerateError(
        error instanceof ImageStudioGenerateError || error instanceof Error
          ? error.message
          : "Image generation failed unexpectedly.",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Shop Intelligence"
        title="AI Image Studio"
        subtitle="Write a prompt and generate lifestyle product photography from your existing item photos."
      />

      {isConfigLoading ? (
        <LoadingState title="Loading Image Studio" description="Fetching models, scenes, and limits." />
      ) : null}

      {!isConfigLoading && configError ? (
        <p className="status-card status-card--error">{configError}</p>
      ) : null}

      {!isConfigLoading && config ? (
        <PageSection gap="lg">
          <div className="image-studio-grid">
            <div className="image-studio-grid__column">
              <ReferenceImagesSection
                mainImage={form.mainImage}
                supportingImages={form.supportingImages}
                limits={config.limits}
                disabled={isGenerating}
                onMainImageChange={(image) => setForm((current) => ({ ...current, mainImage: image }))}
                onSupportingImagesChange={(images) =>
                  setForm((current) => ({ ...current, supportingImages: images }))}
              />

              <PromptEditorSection
                value={form.prompt}
                maxLength={config.limits.maxPromptLength}
                disabled={isGenerating}
                onChange={(value) => setForm((current) => ({ ...current, prompt: value }))}
              />

              <ScenePicker
                scenes={config.scenes}
                activeSceneIds={activeSceneIds}
                disabled={isGenerating}
                onToggle={handleToggleScene}
              />
            </div>

            <div className="image-studio-grid__column image-studio-grid__column--sticky">
              <OutputSettingsSection
                config={config}
                modelId={form.modelId}
                aspectRatio={form.aspectRatio}
                resolution={form.resolution}
                outputFormat={form.outputFormat}
                disabled={isGenerating}
                onModelChange={(modelId) => setForm((current) => ({ ...current, modelId }))}
                onAspectRatioChange={(aspectRatio) => setForm((current) => ({ ...current, aspectRatio }))}
                onResolutionChange={(resolution) => setForm((current) => ({ ...current, resolution }))}
                onOutputFormatChange={(outputFormat) => setForm((current) => ({ ...current, outputFormat }))}
              />

              <GenerationResultPanel
                isGenerating={isGenerating}
                result={result}
                error={generateError}
                canSubmit={canSubmit}
                disabledReason={disabledReason}
                onGenerate={() => void handleGenerate()}
              />
            </div>
          </div>
        </PageSection>
      ) : null}
    </>
  );
}

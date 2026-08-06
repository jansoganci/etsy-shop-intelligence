import { SectionHeader, Select } from "../../../components/ui";
import type {
  ImageStudioAspectRatio,
  ImageStudioConfigResponse,
  ImageStudioModelId,
  ImageStudioOutputFormat,
  ImageStudioResolution,
} from "../../../data/types/imageStudio";

type OutputSettingsSectionProps = {
  config: ImageStudioConfigResponse;
  modelId: ImageStudioModelId | "";
  aspectRatio: ImageStudioAspectRatio | "";
  resolution: ImageStudioResolution | "";
  outputFormat: ImageStudioOutputFormat | "";
  disabled?: boolean;
  onModelChange: (id: ImageStudioModelId) => void;
  onAspectRatioChange: (value: ImageStudioAspectRatio) => void;
  onResolutionChange: (value: ImageStudioResolution) => void;
  onOutputFormatChange: (value: ImageStudioOutputFormat) => void;
};

export function OutputSettingsSection({
  config,
  modelId,
  aspectRatio,
  resolution,
  outputFormat,
  disabled,
  onModelChange,
  onAspectRatioChange,
  onResolutionChange,
  onOutputFormatChange,
}: OutputSettingsSectionProps) {
  const selectedModel = config.models.find((model) => model.id === modelId);
  const hasAspectRatioChoice = config.aspectRatios.length > 1;
  const hasResolutionChoice = config.resolutions.length > 1;
  const hasOutputFormatChoice = config.outputFormats.length > 1;
  const showOutputSpecLine = !hasAspectRatioChoice && !hasResolutionChoice && !hasOutputFormatChoice;

  return (
    <div className="image-studio-section">
      <SectionHeader title="Model" subtitle="Choose the AI engine used to generate your photo." />

      <Select
        label="Model"
        disabled={disabled}
        value={modelId}
        onChange={(event) => onModelChange(event.target.value as ImageStudioModelId)}
        options={config.models.map((model) => ({ value: model.id, label: model.name }))}
        help={selectedModel?.description}
      />

      {hasAspectRatioChoice ? (
        <Select
          label="Aspect ratio"
          disabled={disabled}
          value={aspectRatio}
          onChange={(event) => onAspectRatioChange(event.target.value as ImageStudioAspectRatio)}
          options={config.aspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
        />
      ) : null}

      {hasResolutionChoice ? (
        <Select
          label="Resolution"
          disabled={disabled}
          value={resolution}
          onChange={(event) => onResolutionChange(event.target.value as ImageStudioResolution)}
          options={config.resolutions.map((value) => ({ value, label: value }))}
        />
      ) : null}

      {hasOutputFormatChoice ? (
        <Select
          label="Output format"
          disabled={disabled}
          value={outputFormat}
          onChange={(event) => onOutputFormatChange(event.target.value as ImageStudioOutputFormat)}
          options={config.outputFormats.map((value) => ({ value, label: value.toUpperCase() }))}
        />
      ) : null}

      {showOutputSpecLine ? (
        <p className="image-studio-output-spec">
          <span>
            Output: <strong>{config.aspectRatios[0] ?? "—"}</strong> square ·{" "}
            <strong>{config.resolutions[0] ?? "—"}</strong> ·{" "}
            <strong>{(config.outputFormats[0] ?? "—").toUpperCase()}</strong>
          </span>
        </p>
      ) : null}
    </div>
  );
}

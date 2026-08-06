import { Badge, Button, LoadingState, SectionHeader } from "../../../components/ui";

type GenerationResult = {
  objectUrl: string;
  modelLabel: string;
  downloadFilename: string;
};

type GenerationResultPanelProps = {
  isGenerating: boolean;
  result: GenerationResult | null;
  error: string | null;
  canSubmit: boolean;
  disabledReason: string | null;
  onGenerate: () => void;
};

export function GenerationResultPanel({
  isGenerating,
  result,
  error,
  canSubmit,
  disabledReason,
  onGenerate,
}: GenerationResultPanelProps) {
  return (
    <div className="image-studio-section">
      <SectionHeader title="Generation result" />

      <Button
        variant="primary"
        disabled={!canSubmit || isGenerating}
        onClick={onGenerate}
      >
        {result ? "Generate another" : "Generate"}
      </Button>

      {!canSubmit && !isGenerating && disabledReason ? (
        <small className="field__help">{disabledReason}</small>
      ) : null}

      {isGenerating ? (
        <LoadingState
          title="Generating image"
          description="This can take up to a few minutes depending on the model. Do not close or navigate away."
        />
      ) : null}

      {!isGenerating && error ? <p className="status-card status-card--error">{error}</p> : null}

      {!isGenerating && result ? (
        <div className="image-studio-result">
          <img className="image-studio-result__image" src={result.objectUrl} alt="Generated Etsy product photograph" />
          <Badge variant="accent">{result.modelLabel}</Badge>
          <a
            className="button ui-button ui-button--primary ui-button--md"
            href={result.objectUrl}
            download={result.downloadFilename}
          >
            Download
          </a>
          <small className="field__help">
            This result is temporary. Download it before leaving this page — it will not be saved anywhere else.
          </small>
        </div>
      ) : null}
    </div>
  );
}

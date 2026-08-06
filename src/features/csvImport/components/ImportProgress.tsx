import { Badge } from "../../../components/ui";
import type { ImportSessionState, ImportStage } from "../importSession";

type VisualStepKey = "uploading" | "validating" | "importing" | "processing" | "completed";

const VISUAL_STEPS: { key: VisualStepKey; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "validating", label: "Validating" },
  { key: "importing", label: "Importing" },
  { key: "processing", label: "Processing" },
  { key: "completed", label: "Completed" },
];

type StepState = "done" | "active" | "pending" | "failed";

// The initial POST covers both "uploading" and "validating" in a single
// round trip, so the two visual steps always resolve together.
function failedVisualStep(failedAtStage: ImportStage | null): VisualStepKey {
  if (failedAtStage === "importing" || failedAtStage === "processing") {
    return failedAtStage;
  }
  return "validating";
}

function visualStepState(step: VisualStepKey, session: ImportSessionState): StepState {
  const { stage, failedAtStage } = session;

  if (stage === "idle") {
    return "pending";
  }

  if (stage === "completed") {
    return "done";
  }

  if (stage === "failed") {
    const failedStep = failedVisualStep(failedAtStage);
    const failedRank = VISUAL_STEPS.findIndex((entry) => entry.key === failedStep);
    const stepRank = VISUAL_STEPS.findIndex((entry) => entry.key === step);
    if (stepRank < failedRank) return "done";
    if (stepRank === failedRank) return "failed";
    return "pending";
  }

  if (stage === "uploading") {
    return step === "uploading" ? "active" : "pending";
  }

  // stage is "importing" or "processing": uploading + validating are implicitly done.
  if (step === "uploading" || step === "validating") {
    return "done";
  }
  const stepRank = VISUAL_STEPS.findIndex((entry) => entry.key === step);
  const currentRank = VISUAL_STEPS.findIndex((entry) => entry.key === stage);
  if (stepRank < currentRank) return "done";
  if (stepRank === currentRank) return "active";
  return "pending";
}

function stepIcon(state: StepState): string {
  if (state === "done") return "✓";
  if (state === "failed") return "!";
  if (state === "active") return "…";
  return "";
}

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) {
    return "—";
  }
  if (start === end) {
    return start ?? "—";
  }
  return `${start ?? "?"} – ${end ?? "?"}`;
}

export function ImportProgress({ session }: { session: ImportSessionState }) {
  if (session.stage === "idle") {
    return null;
  }

  return (
    <div className="import-progress" aria-live="polite">
      <ol className="import-stepper">
        {VISUAL_STEPS.map((step) => {
          const state = visualStepState(step.key, session);
          return (
            <li key={step.key} className={`import-stepper__step import-stepper__step--${state}`}>
              <span className="import-stepper__icon" aria-hidden="true">
                {stepIcon(state)}
              </span>
              <span className="import-stepper__label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="import-summary">
        <div className="import-summary__item">
          <span className="import-summary__label">Import ID</span>
          <strong>{session.importId ?? "—"}</strong>
        </div>
        <div className="import-summary__item">
          <span className="import-summary__label">Imported</span>
          <strong>{formatCount(session.insertedCount)}</strong>
        </div>
        <div className="import-summary__item">
          <span className="import-summary__label">Skipped</span>
          <strong>{formatCount(session.skippedCount)}</strong>
        </div>
        <div className="import-summary__item">
          <span className="import-summary__label">Errors</span>
          <strong>{formatCount(session.errorCount)}</strong>
        </div>
        <div className="import-summary__item import-summary__item--wide">
          <span className="import-summary__label">Import period</span>
          <strong>{formatDateRange(session.dateRangeStart, session.dateRangeEnd)}</strong>
        </div>
      </div>

      {session.stage === "completed" ? (
        <p className="status-card status-card--success">
          <Badge variant="success" size="sm">
            {session.duplicateFile ? "Already imported" : "Import complete"}
          </Badge>{" "}
          {session.duplicateFile
            ? (session.errorMessage ?? "This file was already imported and was skipped.")
            : `${session.fileName ?? "File"} finished importing.`}
        </p>
      ) : null}

      {session.stage === "failed" ? (
        <p className="status-card status-card--error">
          <Badge variant="error" size="sm">
            Import failed
          </Badge>{" "}
          {session.errorMessage ?? "Unable to import this CSV file."}
        </p>
      ) : null}
    </div>
  );
}

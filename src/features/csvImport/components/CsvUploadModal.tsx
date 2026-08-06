import { useMemo, useRef, useState } from "react";
import "../csv-import.css";
import type { CsvReportType, ImportRecord } from "../../../data/models/records";
import type { ImportSessionState } from "../importSession";
import { CSV_REPORT_OPTIONS } from "../reportTypes";
import { ImportProgress } from "./ImportProgress";

type CsvUploadModalProps = {
  isOpen: boolean;
  session: ImportSessionState;
  imports: ImportRecord[];
  onStart: (file: File, reportType: CsvReportType) => Promise<void>;
  onRetry: () => Promise<void>;
  onReset: () => void;
  onClose: () => void;
};

const BUSY_STAGES = new Set<ImportSessionState["stage"]>(["uploading", "importing", "processing"]);

export function CsvUploadModal({
  isOpen,
  session,
  imports,
  onStart,
  onRetry,
  onReset,
  onClose,
}: CsvUploadModalProps) {
  const [reportType, setReportType] = useState<CsvReportType>("direct_checkout_payments");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeOption = useMemo(
    () => CSV_REPORT_OPTIONS.find((option) => option.value === reportType),
    [reportType],
  );

  const duplicateImport = useMemo(() => {
    if (!selectedFile) {
      return null;
    }

    const normalizedName = selectedFile.name.trim().toLowerCase();

    return (
      imports.find(
        (item) =>
          item.fileName.trim().toLowerCase() === normalizedName && item.reportType === reportType,
      ) ?? null
    );
  }, [imports, reportType, selectedFile]);

  if (!isOpen) {
    return null;
  }

  const isIdle = session.stage === "idle";
  const isBusy = BUSY_STAGES.has(session.stage);
  const isTerminal = session.stage === "completed" || session.stage === "failed";

  const requestClose = () => {
    if (isBusy) {
      setShowCloseConfirm(true);
      return;
    }

    if (isTerminal) {
      onReset();
    }

    setShowCloseConfirm(false);
    setSelectedFile(null);
    setLocalError(null);
    onClose();
  };

  const confirmCloseAnyway = () => {
    // The import keeps running/polling in the background; we're only hiding
    // the modal, not cancelling anything.
    setShowCloseConfirm(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (!isIdle) {
      return;
    }

    if (!activeOption?.enabled) {
      setLocalError("This report type is not available yet.");
      return;
    }

    if (!selectedFile) {
      setLocalError("Please choose a CSV file to continue.");
      return;
    }

    setLocalError(null);
    await onStart(selectedFile, reportType);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={requestClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-upload-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="eyebrow">Import report</span>
            <h3 id="csv-upload-modal-title">Upload Etsy CSV</h3>
          </div>
          <button className="modal__close" type="button" onClick={requestClose} aria-label="Close upload modal">
            Close
          </button>
        </div>

        <div className="modal__body">
          {showCloseConfirm ? (
            <div className="import-close-confirm" role="alertdialog" aria-label="Confirm close">
              <p>
                This import is still running. Closing the window won&apos;t stop it — we&apos;ll keep
                tracking its progress in the background.
              </p>
              <div className="import-close-confirm__actions">
                <button
                  className="header-action"
                  type="button"
                  onClick={() => setShowCloseConfirm(false)}
                >
                  Keep watching
                </button>
                <button className="header-action" type="button" onClick={confirmCloseAnyway}>
                  Close anyway
                </button>
              </div>
            </div>
          ) : null}

          {isIdle ? (
            <>
              <label className="field">
                <span className="field__label">Report type</span>
                <select
                  className="field__control"
                  value={reportType}
                  onChange={(event) => {
                    setReportType(event.target.value as CsvReportType);
                    setSelectedFile(null);
                    setLocalError(null);
                  }}
                >
                  {CSV_REPORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                      {option.enabled ? "" : " (coming soon)"}
                    </option>
                  ))}
                </select>
                <small className="field__help">{activeOption?.description}</small>
              </label>

              <label className="field">
                <span className="field__label">CSV file</span>
                <button
                  className="modal__file-button"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={!activeOption?.enabled}
                >
                  {selectedFile ? selectedFile.name : "Choose CSV file"}
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    setLocalError(null);
                    event.currentTarget.value = "";
                  }}
                />
                <small className="field__help">
                  The backend will detect the Etsy CSV type from the uploaded file headers before writing to D1.
                </small>
              </label>

              {duplicateImport ? (
                <p className="status-card status-card--warning">
                  This file looks like it was already imported. Importing it again may create
                  duplicate rows.
                </p>
              ) : null}
              {localError ? <p className="status-card status-card--error">{localError}</p> : null}
            </>
          ) : (
            <ImportProgress session={session} />
          )}
        </div>

        <div className="modal__footer">
          {isIdle ? (
            <>
              <button className="header-action" type="button" onClick={requestClose}>
                Cancel
              </button>
              <button
                className="header-action header-action--primary"
                type="button"
                onClick={handleSubmit}
              >
                Import CSV
              </button>
            </>
          ) : null}

          {isBusy ? (
            <button className="header-action" type="button" onClick={requestClose}>
              Close
            </button>
          ) : null}

          {session.stage === "failed" ? (
            <>
              <button className="header-action" type="button" onClick={requestClose}>
                Close
              </button>
              <button
                className="header-action header-action--primary"
                type="button"
                onClick={() => void onRetry()}
              >
                Retry
              </button>
            </>
          ) : null}

          {session.stage === "completed" ? (
            <button className="header-action header-action--primary" type="button" onClick={requestClose}>
              Done
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

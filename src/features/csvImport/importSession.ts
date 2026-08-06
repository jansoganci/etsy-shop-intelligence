import type { CsvReportType } from "../../data/models/records";

export type ImportStage = "idle" | "uploading" | "importing" | "processing" | "completed" | "failed";

export type ImportSessionState = {
  stage: ImportStage;
  /** Which stage was in flight when a failure happened, for stepper display. */
  failedAtStage: ImportStage | null;
  importId: number | null;
  fileName: string | null;
  reportType: CsvReportType | null;
  rowCount: number | null;
  insertedCount: number | null;
  skippedCount: number | null;
  errorCount: number | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  duplicateFile: boolean;
  errorMessage: string | null;
};

export const INITIAL_IMPORT_SESSION_STATE: ImportSessionState = {
  stage: "idle",
  failedAtStage: null,
  importId: null,
  fileName: null,
  reportType: null,
  rowCount: null,
  insertedCount: null,
  skippedCount: null,
  errorCount: null,
  dateRangeStart: null,
  dateRangeEnd: null,
  duplicateFile: false,
  errorMessage: null,
};

const BUSY_STAGES = new Set<ImportStage>(["uploading", "importing", "processing"]);

export type ImportAcceptedResponse = {
  importId: number;
  status: "pending" | "duplicate_skipped";
  duplicateFile?: boolean;
  message?: string;
  rowCount?: number;
  insertedCount?: number;
  skippedCount?: number;
  errorCount?: number;
};

export type ImportStatusResponse = {
  importId: number;
  status: string;
  rowCount: number;
  insertedCount: number;
  skippedCount: number;
  errorCount: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  errorMessage: string | null;
};

export type ImportSessionDeps = {
  uploadCsv: (file: File, reportType: CsvReportType) => Promise<ImportAcceptedResponse>;
  fetchStatus: (importId: number) => Promise<ImportStatusResponse>;
  onTerminal?: (state: ImportSessionState) => void | Promise<void>;
  pollIntervalMs?: number;
};

function serverStatusToStage(status: string): ImportStage {
  switch (status) {
    case "processing":
      return "processing";
    case "completed":
    case "partial":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
    case "importing":
    default:
      return "importing";
  }
}

/**
 * Framework-independent CSV import stage machine: submits the file, then
 * polls the status endpoint until a terminal state is reached. Kept free of
 * React so the polling/duplicate-guard/retry logic can be unit tested
 * directly (this project has no jsdom/testing-library dependency).
 */
export class CsvImportSession {
  #state: ImportSessionState = { ...INITIAL_IMPORT_SESSION_STATE };
  #listeners = new Set<(state: ImportSessionState) => void>();
  #deps: ImportSessionDeps;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #pollToken = 0;
  #lastFile: File | null = null;
  #lastReportType: CsvReportType | null = null;

  constructor(deps: ImportSessionDeps) {
    this.#deps = deps;
  }

  getState(): ImportSessionState {
    return this.#state;
  }

  subscribe(listener: (state: ImportSessionState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** True while a critical stage is in flight; used to guard closing the modal. */
  isBusy(): boolean {
    return BUSY_STAGES.has(this.#state.stage);
  }

  async start(file: File, reportType: CsvReportType): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    this.#stopPolling();
    this.#lastFile = file;
    this.#lastReportType = reportType;

    this.#setState({
      ...INITIAL_IMPORT_SESSION_STATE,
      stage: "uploading",
      fileName: file.name,
      reportType,
    });

    await this.#submit(file, reportType);
  }

  async retry(): Promise<void> {
    if (this.isBusy() || !this.#lastFile || !this.#lastReportType) {
      return;
    }

    await this.start(this.#lastFile, this.#lastReportType);
  }

  /** Returns to idle. No-op while busy — the caller should guard closing separately. */
  reset(): void {
    if (this.isBusy()) {
      return;
    }

    this.#stopPolling();
    this.#setState({ ...INITIAL_IMPORT_SESSION_STATE });
  }

  stop(): void {
    this.#stopPolling();
  }

  async #submit(file: File, reportType: CsvReportType): Promise<void> {
    let accepted: ImportAcceptedResponse;

    try {
      accepted = await this.#deps.uploadCsv(file, reportType);
    } catch (error) {
      this.#setState({
        stage: "failed",
        failedAtStage: "uploading",
        errorMessage: error instanceof Error ? error.message : "Unable to import this CSV file.",
      });
      await this.#deps.onTerminal?.(this.#state);
      return;
    }

    if (accepted.status === "duplicate_skipped") {
      this.#setState({
        stage: "completed",
        importId: accepted.importId,
        duplicateFile: true,
        rowCount: accepted.rowCount ?? null,
        insertedCount: accepted.insertedCount ?? 0,
        skippedCount: accepted.skippedCount ?? null,
        errorCount: accepted.errorCount ?? 0,
        errorMessage: accepted.message ?? null,
      });
      await this.#deps.onTerminal?.(this.#state);
      return;
    }

    this.#setState({
      stage: "importing",
      importId: accepted.importId,
      rowCount: accepted.rowCount ?? null,
    });
    this.#pollUntilTerminal(accepted.importId);
  }

  #pollUntilTerminal(importId: number): void {
    const token = ++this.#pollToken;
    const intervalMs = this.#deps.pollIntervalMs ?? 1500;

    const tick = async () => {
      if (token !== this.#pollToken) {
        return;
      }

      let status: ImportStatusResponse;
      try {
        status = await this.#deps.fetchStatus(importId);
      } catch {
        // Transient poll failure: keep polling rather than surfacing a false failure.
        this.#pollTimer = setTimeout(tick, intervalMs);
        return;
      }

      if (token !== this.#pollToken) {
        return;
      }

      const nextStage = serverStatusToStage(status.status);

      if (nextStage === "completed" || nextStage === "failed") {
        const failedAtStage = nextStage === "failed" ? this.#state.stage : null;
        this.#setState({
          stage: nextStage,
          failedAtStage,
          insertedCount: status.insertedCount,
          skippedCount: status.skippedCount,
          errorCount: status.errorCount,
          rowCount: status.rowCount,
          dateRangeStart: status.dateRangeStart,
          dateRangeEnd: status.dateRangeEnd,
          errorMessage: status.errorMessage,
        });
        await this.#deps.onTerminal?.(this.#state);
        return;
      }

      this.#setState({ stage: nextStage });
      this.#pollTimer = setTimeout(tick, intervalMs);
    };

    void tick();
  }

  #stopPolling(): void {
    this.#pollToken += 1;
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #setState(patch: Partial<ImportSessionState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

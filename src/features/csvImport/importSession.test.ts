import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CsvImportSession,
  type ImportAcceptedResponse,
  type ImportSessionDeps,
  type ImportStage,
  type ImportStatusResponse,
} from "./importSession";

function testFile(name = "payments.csv"): File {
  return new File(["Payment ID\nPAY-1"], name, { type: "text/csv" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CsvImportSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls through importing/processing and reaches completed on a delayed import", async () => {
    const statuses: ImportStatusResponse["status"][] = ["importing", "importing", "processing", "completed"];
    const fetchStatus = vi.fn(async (): Promise<ImportStatusResponse> => {
      const status = statuses.shift() ?? "completed";
      return {
        importId: 1,
        status,
        rowCount: 2,
        insertedCount: status === "completed" ? 2 : 0,
        skippedCount: 0,
        errorCount: 0,
        dateRangeStart: status === "completed" ? "2026-01-01" : null,
        dateRangeEnd: status === "completed" ? "2026-01-31" : null,
        errorMessage: null,
      };
    });
    const uploadCsv = vi.fn(
      async (): Promise<ImportAcceptedResponse> => ({ importId: 1, status: "pending", rowCount: 2 }),
    );
    const onTerminal = vi.fn();

    const session = new CsvImportSession({ uploadCsv, fetchStatus, onTerminal, pollIntervalMs: 1000 });
    const states: ImportStage[] = [];
    session.subscribe((state) => states.push(state.stage));

    const startPromise = session.start(testFile(), "direct_checkout_payments");
    await startPromise;
    expect(session.getState().stage).toBe("importing");
    expect(session.isBusy()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(session.getState().stage).toBe("completed");
    expect(session.getState().insertedCount).toBe(2);
    expect(session.getState().dateRangeStart).toBe("2026-01-01");
    expect(fetchStatus).toHaveBeenCalledTimes(4);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(session.isBusy()).toBe(false);
  });

  it("surfaces the exact backend error and the stage it failed at", async () => {
    let poll = 0;
    const fetchStatus = vi.fn(async (): Promise<ImportStatusResponse> => {
      poll += 1;
      if (poll === 1) {
        return {
          importId: 1,
          status: "importing",
          rowCount: 5,
          insertedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          dateRangeStart: null,
          dateRangeEnd: null,
          errorMessage: null,
        };
      }
      return {
        importId: 1,
        status: "failed",
        rowCount: 5,
        insertedCount: 0,
        skippedCount: 5,
        errorCount: 0,
        dateRangeStart: null,
        dateRangeEnd: null,
        errorMessage: "Sold Order Items require matching Sold Orders. Import Sold Orders first.",
      };
    });
    const uploadCsv = vi.fn(
      async (): Promise<ImportAcceptedResponse> => ({ importId: 1, status: "pending", rowCount: 5 }),
    );

    const session = new CsvImportSession({ uploadCsv, fetchStatus, pollIntervalMs: 1000 });
    await session.start(testFile("order-items.csv"), "sold_order_items");

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const state = session.getState();
    expect(state.stage).toBe("failed");
    expect(state.failedAtStage).toBe("importing");
    expect(state.errorMessage).toBe(
      "Sold Order Items require matching Sold Orders. Import Sold Orders first.",
    );
  });

  it("ignores a second start() call while an import is still running", async () => {
    const { promise: uploadGate, resolve: releaseUpload } = deferred<ImportAcceptedResponse>();
    const uploadCsv = vi.fn(() => uploadGate);
    const fetchStatus = vi.fn(
      async (): Promise<ImportStatusResponse> => ({
        importId: 1,
        status: "importing",
        rowCount: 1,
        insertedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        dateRangeStart: null,
        dateRangeEnd: null,
        errorMessage: null,
      }),
    );

    const session = new CsvImportSession({ uploadCsv, fetchStatus, pollIntervalMs: 1000 });

    const first = session.start(testFile(), "direct_checkout_payments");
    // Fires while the first upload is still in flight — must be a no-op.
    const second = session.start(testFile(), "direct_checkout_payments");

    releaseUpload({ importId: 1, status: "pending", rowCount: 1 });
    await Promise.all([first, second]);

    expect(uploadCsv).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it("resubmits the last file and report type on retry", async () => {
    const uploadCsv = vi
      .fn<ImportSessionDeps["uploadCsv"]>()
      .mockRejectedValueOnce(new Error("Network error while uploading CSV."))
      .mockResolvedValueOnce({ importId: 2, status: "pending", rowCount: 1 });
    const fetchStatus = vi.fn(
      async (): Promise<ImportStatusResponse> => ({
        importId: 2,
        status: "completed",
        rowCount: 1,
        insertedCount: 1,
        skippedCount: 0,
        errorCount: 0,
        dateRangeStart: "2026-03-01",
        dateRangeEnd: "2026-03-01",
        errorMessage: null,
      }),
    );

    const session = new CsvImportSession({ uploadCsv, fetchStatus, pollIntervalMs: 1000 });
    const file = testFile();

    await session.start(file, "direct_checkout_payments");
    expect(session.getState().stage).toBe("failed");
    expect(session.getState().failedAtStage).toBe("uploading");

    await session.retry();
    await vi.advanceTimersByTimeAsync(1000);

    expect(uploadCsv).toHaveBeenCalledTimes(2);
    expect(uploadCsv).toHaveBeenNthCalledWith(2, file, "direct_checkout_payments");
    expect(session.getState().stage).toBe("completed");
  });

  it("only calls onTerminal once and reset() returns to idle after completion", async () => {
    const uploadCsv = vi.fn(
      async (): Promise<ImportAcceptedResponse> => ({ importId: 3, status: "duplicate_skipped", rowCount: 4, skippedCount: 4 }),
    );
    const fetchStatus = vi.fn();
    const onTerminal = vi.fn();

    const session = new CsvImportSession({ uploadCsv, fetchStatus, onTerminal });
    await session.start(testFile(), "direct_checkout_payments");

    expect(session.getState().stage).toBe("completed");
    expect(session.getState().duplicateFile).toBe(true);
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(onTerminal).toHaveBeenCalledTimes(1);

    session.reset();
    expect(session.getState().stage).toBe("idle");
    expect(session.getState().importId).toBeNull();
  });
});

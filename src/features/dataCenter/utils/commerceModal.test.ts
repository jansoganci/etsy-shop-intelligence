import { describe, expect, it } from "vitest";
import { shouldOpenCommerceSummaryModal } from "./commerceModal";

describe("shouldOpenCommerceSummaryModal", () => {
  it("opens once when a period run finishes", () => {
    expect(
      shouldOpenCommerceSummaryModal({
        wasActive: true,
        isActive: false,
        isPeriodRun: true,
        runId: "run-1",
        lastHandledRunId: null,
      }),
    ).toBe(true);
  });

  it("does not reopen for the same run id", () => {
    expect(
      shouldOpenCommerceSummaryModal({
        wasActive: true,
        isActive: false,
        isPeriodRun: true,
        runId: "run-1",
        lastHandledRunId: "run-1",
      }),
    ).toBe(false);
  });

  it("ignores non-period runs", () => {
    expect(
      shouldOpenCommerceSummaryModal({
        wasActive: true,
        isActive: false,
        isPeriodRun: false,
        runId: "run-shop",
        lastHandledRunId: null,
      }),
    ).toBe(false);
  });

  it("does not open while the run is still active", () => {
    expect(
      shouldOpenCommerceSummaryModal({
        wasActive: true,
        isActive: true,
        isPeriodRun: true,
        runId: "run-1",
        lastHandledRunId: null,
      }),
    ).toBe(false);
  });

  it("does not open without a run id", () => {
    expect(
      shouldOpenCommerceSummaryModal({
        wasActive: true,
        isActive: false,
        isPeriodRun: true,
        runId: null,
        lastHandledRunId: null,
      }),
    ).toBe(false);
  });
});

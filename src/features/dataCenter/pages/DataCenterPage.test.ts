import { describe, expect, it } from "vitest";
import {
  isActiveReconciliationRun,
  isActiveRun,
  resolveSyncBanner,
  viewFromPath,
} from "./DataCenterPage";
import type { EtsySyncRun } from "../../../data/types/etsyApi";
import type { ReconciliationRun } from "../../../data/types/dataCenter";

function makeRun(overrides: Partial<EtsySyncRun>): EtsySyncRun {
  return {
    id: "run-1",
    shopId: "shop-1",
    requestedResource: "commerce",
    status: "running",
    controlState: "running",
    pauseReason: null,
    currentResource: "receipts",
    qpdRemaining: 9810,
    qpsRemaining: 10,
    startedAt: "2026-07-26T10:00:00Z",
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-26T10:00:00Z",
    updatedAt: "2026-07-26T10:00:00Z",
    resources: [],
    ...overrides,
  };
}

describe("Data Center navigation", () => {
  it.each([
    ["/data-center", "overview"],
    ["/data-center/", "overview"],
    ["/data-center/sync", "sync"],
    ["/data-center/imports", "imports"],
    ["/data-center/reconciliation", "reconciliation"],
    ["/data-center/reviews", "reviews"],
    ["/data-center/financial-controls", "financial-controls"],
  ])("maps %s to %s", (path, expected) => {
    expect(viewFromPath(path)).toBe(expected);
  });

  it("falls back to overview for an unknown child path", () => {
    expect(viewFromPath("/data-center/unknown")).toBe("overview");
  });
});

describe("Etsy sync banner priority", () => {
  it("shows nothing for a healthy running job with high remaining quota", () => {
    const run = makeRun({ status: "running", controlState: "running", qpdRemaining: 9810 });
    expect(resolveSyncBanner(run)).toBeNull();
  });

  it("lets a cancelled state override an older rate-limit warning still on the row", () => {
    const run = makeRun({
      status: "cancelled",
      controlState: "cancelled",
      pauseReason: "user_cancelled",
      errorCode: "user_cancelled",
      errorMessage: "Sync cancelled by user. Stored data and cursors were kept.",
    });
    expect(resolveSyncBanner(run)).toEqual({
      variant: "error",
      message: "Sync cancelled by user. Stored data and cursors were kept.",
    });
  });

  it("shows the cancel banner while control_state is still cancelling, before status flips", () => {
    const run = makeRun({
      status: "rate_limited",
      controlState: "cancelling",
      errorMessage: "Sync cancelled by user. Stored data and cursors were kept.",
    });
    const banner = resolveSyncBanner(run);
    expect(banner?.variant).toBe("error");
    expect(banner?.message).toContain("cancelled");
  });

  it("prioritizes the soft-budget pause message when paused for daily_budget", () => {
    const run = makeRun({
      status: "rate_limited",
      controlState: "paused",
      pauseReason: "daily_budget",
      errorCode: "daily_budget",
      errorMessage: "Soft Etsy QPD reserve reached. Continue tomorrow or resume when remaining quota recovers.",
    });
    const banner = resolveSyncBanner(run);
    expect(banner?.variant).toBe("warning");
    expect(banner?.message).toContain("soft limit");
  });

  it("shows a distinct message for a user-initiated pause", () => {
    const run = makeRun({
      status: "running",
      controlState: "paused",
      pauseReason: "user_paused",
      errorMessage: "Sync paused by user.",
    });
    expect(resolveSyncBanner(run)).toEqual({
      variant: "warning",
      message: "Sync paused by user.",
    });
  });

  it("does not combine the pause banner with the underlying error message", () => {
    const run = makeRun({
      status: "rate_limited",
      controlState: "paused",
      pauseReason: "daily_budget",
      errorMessage: "Soft daily budget reached. Resume manually or wait for the next day.",
    });
    const banner = resolveSyncBanner(run);
    // Only one banner is ever returned — never both the soft-budget copy and
    // the raw backend error message at the same time.
    expect(banner).not.toBeNull();
    expect([banner?.message]).toHaveLength(1);
  });

  it("returns null when there is no active run", () => {
    expect(resolveSyncBanner(null)).toBeNull();
  });
});

describe("isActiveRun after cancellation", () => {
  it("treats a rate-limited, non-paused run as active (buttons disabled)", () => {
    expect(isActiveRun(makeRun({ status: "rate_limited", controlState: "running" }))).toBe(true);
  });

  it("treats a fully cancelled run as inactive so other sync buttons re-enable", () => {
    expect(
      isActiveRun(makeRun({ status: "cancelled", controlState: "cancelled" })),
    ).toBe(false);
  });

  it("still treats an in-flight cancellation as active until control_state settles", () => {
    expect(
      isActiveRun(makeRun({ status: "running", controlState: "cancelling" })),
    ).toBe(true);
  });
});

describe("reconciliation run polling", () => {
  it("keeps polling only queued and running reconciliation runs", () => {
    const run = {
      id: "reconciliation-1",
      status: "running",
    } as ReconciliationRun;
    expect(isActiveReconciliationRun(run)).toBe(true);
    expect(isActiveReconciliationRun({ ...run, status: "queued" })).toBe(true);
    expect(isActiveReconciliationRun({ ...run, status: "completed" })).toBe(false);
    expect(isActiveReconciliationRun({ ...run, status: "cancelled" })).toBe(false);
  });
});

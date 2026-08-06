import { describe, expect, it } from "vitest";
import {
  ETSY_OFFSET_MAX,
  ETSY_PAGE_SIZE_MAX,
  deterministicTaskKey,
  needsWindowSplit,
  normalizePageSize,
  pageKeyForTask,
  splitTaskPlan,
  splitTimeWindow,
} from "./planner";
import { AdapterRegistry } from "./registry";

describe("generic sync planner", () => {
  it("caps every adapter page at Etsy's maximum", () => {
    expect(normalizePageSize(1_000)).toBe(ETSY_PAGE_SIZE_MAX);
    expect(normalizePageSize(0)).toBe(1);
  });

  it("splits an inclusive timestamp window without overlap or a gap", () => {
    const [left, right] = splitTimeWindow({ start: 100, end: 199 });
    expect(left).toEqual({ start: 100, end: 149 });
    expect(right).toEqual({ start: 150, end: 199 });
  });

  it("requires splitting before Etsy's offset ceiling is exceeded", () => {
    expect(needsWindowSplit(ETSY_OFFSET_MAX)).toBe(false);
    expect(needsWindowSplit(ETSY_OFFSET_MAX + 1)).toBe(true);
    expect(needsWindowSplit(120_000)).toBe(true);
  });

  it("creates deterministic task and page keys", () => {
    const first = deterministicTaskKey("run", "receipts", "time_windowed", 10, 20, 0);
    const second = deterministicTaskKey("run", "receipts", "time_windowed", 10, 20, 0);
    expect(first).toBe(second);
    expect(
      pageKeyForTask({
        resource: "receipts",
        segmentStart: 10,
        segmentEnd: 20,
        pageOffset: 100,
      }),
    ).toBe("receipts:10:20:100");
  });

  it("plans two deterministic children for an oversized segment", () => {
    const plans = splitTaskPlan({
      runId: "run",
      resource: "receipts",
      adapterVersion: 1,
      segmentStart: 100,
      segmentEnd: 199,
      pageSize: 100,
    });
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => [plan.segmentStart, plan.segmentEnd])).toEqual([
      [100, 149],
      [150, 199],
    ]);
    expect(new Set(plans.map((plan) => plan.idempotencyKey)).size).toBe(2);
  });
});

describe("adapter registry", () => {
  it("rejects duplicate resource adapters", () => {
    const adapter = { resource: "receipts" } as never;
    const registry = new AdapterRegistry().register(adapter);
    expect(() => registry.register(adapter)).toThrow("duplicate_adapter:receipts");
  });
});

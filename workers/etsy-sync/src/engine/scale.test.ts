import { describe, expect, it } from "vitest";
import {
  ETSY_OFFSET_MAX,
  splitTimeWindow,
  type TimeWindow,
} from "./planner";

function planByDensity(
  totalRecords: number,
  root: TimeWindow = { start: 0, end: 119_999 },
): Array<{ window: TimeWindow; count: number }> {
  const result: Array<{ window: TimeWindow; count: number }> = [];
  const queue: Array<{ window: TimeWindow; count: number }> = [
    { window: root, count: totalRecords },
  ];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.count <= ETSY_OFFSET_MAX) {
      result.push(current);
      continue;
    }
    const [left, right] = splitTimeWindow(current.window);
    const leftDuration = left.end - left.start + 1;
    const duration = current.window.end - current.window.start + 1;
    const leftCount = Math.floor((current.count * leftDuration) / duration);
    queue.push(
      { window: left, count: leftCount },
      { window: right, count: current.count - leftCount },
    );
  }
  return result;
}

describe("large receipt backfill planning", () => {
  it("splits more than 12,000 receipts before the offset ceiling", () => {
    const segments = planByDensity(12_001);
    expect(segments.length).toBe(2);
    expect(Math.max(...segments.map((segment) => segment.count))).toBeLessThanOrEqual(
      ETSY_OFFSET_MAX,
    );
  });

  it("plans a simulated 120,000 receipt shop without an oversized segment", () => {
    const segments = planByDensity(120_000);
    expect(segments.reduce((sum, segment) => sum + segment.count, 0)).toBe(120_000);
    expect(Math.max(...segments.map((segment) => segment.count))).toBeLessThanOrEqual(
      ETSY_OFFSET_MAX,
    );
    expect(Math.ceil(120_000 / 100)).toBe(1_200);
  });

  it("does not split a small sync", () => {
    expect(planByDensity(300)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  isSummaryRange,
  loadGaSummary,
  type D1Database,
  type D1PreparedStatement,
} from "./_summary";

function createRoutingDb(handlers: {
  first?: (sql: string, bound: unknown[]) => Promise<unknown>;
  all?: (sql: string, bound: unknown[]) => Promise<{ results?: unknown[] }>;
}): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      const bound: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          bound.push(...values);
          return stmt;
        },
        first: async <T = Record<string, unknown>>() =>
          ((await handlers.first?.(query, bound)) ?? null) as T | null,
        all: async <T = Record<string, unknown>>() =>
          (handlers.all?.(query, bound) ?? Promise.resolve({ results: [] })) as Promise<{
            results?: T[];
          }>,
      };
      return stmt;
    },
  };
}

describe("isSummaryRange", () => {
  it("accepts the four UI ranges", () => {
    expect(isSummaryRange("30d")).toBe(true);
    expect(isSummaryRange("90d")).toBe(true);
    expect(isSummaryRange("180d")).toBe(true);
    expect(isSummaryRange("365d")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isSummaryRange("7d")).toBe(false);
    expect(isSummaryRange(null)).toBe(false);
    expect(isSummaryRange(undefined)).toBe(false);
  });
});

describe("loadGaSummary", () => {
  it("returns null when there is no completed sync", async () => {
    const db = createRoutingDb({
      first: async () => null,
    });

    await expect(loadGaSummary(db)).resolves.toBeNull();
  });

  it("defaults range to 90d and applies breakdownLimit", async () => {
    const limits: number[] = [];

    const db = createRoutingDb({
      first: async (sql) => {
        if (sql.includes("ga_sync_runs")) {
          return {
            syncRunId: 1,
            propertyId: "prop-1",
            dateFrom: "30daysAgo",
            dateTo: "today",
            status: "completed",
            syncedAt: "2026-07-28T00:00:00.000Z",
          };
        }
        if (sql.includes("SUM(active_users)")) {
          return {
            activeUsers: 10,
            sessions: 20,
            screenPageViews: 30,
            eventCount: 40,
          };
        }
        return null;
      },
      all: async (sql, bound) => {
        if (sql.includes("FROM ga_daily_metrics") && sql.includes("SELECT date")) {
          return { results: [{ date: "2026-07-27" }] };
        }
        if (sql.includes("ORDER BY date ASC")) {
          return {
            results: [
              {
                date: "2026-07-27",
                activeUsers: 10,
                sessions: 20,
                screenPageViews: 30,
                eventCount: 40,
              },
            ],
          };
        }
        if (
          sql.includes("LIMIT ?") &&
          (sql.includes("ga_top_pages") ||
            sql.includes("ga_countries") ||
            sql.includes("ga_events"))
        ) {
          limits.push(bound[bound.length - 1] as number);
        }
        return { results: [] };
      },
    });

    const summary = await loadGaSummary(db, undefined, { breakdownLimit: 10 });

    expect(summary).not.toBeNull();
    expect(summary!.range).toBe("90d");
    expect(summary!.source).toBe("google_analytics");
    expect(summary!.kpis.sessions).toBe(20);
    expect(summary!.lastSync.dateFrom).toBe("30daysAgo");
    expect(summary!.warnings.some((warning) => warning.includes("last sync window"))).toBe(
      true,
    );
    expect(limits).toEqual([10, 10, 10]);
  });

  it("warns when daily metrics are empty", async () => {
    const db = createRoutingDb({
      first: async (sql) => {
        if (sql.includes("ga_sync_runs")) {
          return {
            syncRunId: 2,
            propertyId: "prop-1",
            dateFrom: "30daysAgo",
            dateTo: "today",
            status: "completed",
            syncedAt: "2026-07-28T00:00:00.000Z",
          };
        }
        return null;
      },
      all: async () => ({ results: [] }),
    });

    const summary = await loadGaSummary(db, "30d");

    expect(summary!.range).toBe("30d");
    expect(summary!.kpis).toEqual({
      activeUsers: 0,
      sessions: 0,
      screenPageViews: 0,
      eventCount: 0,
    });
    expect(summary!.warnings.some((warning) => warning.includes("No daily metrics"))).toBe(
      true,
    );
  });
});

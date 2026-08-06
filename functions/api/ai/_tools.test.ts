import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, executeTool, isKnownTool } from "./_tools";

describe("tool registry", () => {
  it("defines the Phase 4–5 tools plus get_ga_summary", () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.function.name).sort();

    expect(names).toEqual(
      [
        "compare_periods",
        "get_ga_summary",
        "get_listing_movers",
        "get_listing_performance",
        "get_monthly_etsy_stats",
        "get_shop_events",
        "get_shop_overview",
        "get_stability_metrics",
        "get_top_listings",
        "get_traffic_source_changes",
        "get_relevant_memories",
        "save_memory",
      ].sort(),
    );
  });

  it("every tool has a non-empty description", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.function.description.length).toBeGreaterThan(10);
    }
  });

  it("recognizes known tool names only", () => {
    expect(isKnownTool("get_shop_overview")).toBe(true);
    expect(isKnownTool("get_ga_summary")).toBe(true);
    expect(isKnownTool("save_memory")).toBe(true);
    expect(isKnownTool("drop_table")).toBe(false);
  });
});

describe("executeTool", () => {
  it("returns an unknown_tool error for unrecognized tool names", async () => {
    const result = await executeTool({} as never, "delete_everything", {});

    expect(result).toEqual({ error: "unknown_tool", tool: "delete_everything" });
  });

  it("returns a listingId_required error when get_listing_performance is called without an id", async () => {
    const result = await executeTool({} as never, "get_listing_performance", {});

    expect(result).toEqual({ error: "listingId_required" });
  });

  it("returns an invalid_memory_input error for save_memory with an unknown memoryType", async () => {
    const result = await executeTool({} as never, "save_memory", {
      memoryType: "made_up_type",
      content: "test",
    });

    expect(result).toEqual({ error: "invalid_memory_input" });
  });

  it("returns an invalid_memory_input error for save_memory with empty content", async () => {
    const result = await executeTool({} as never, "save_memory", { memoryType: "goal", content: "   " });

    expect(result).toEqual({ error: "invalid_memory_input" });
  });

  it("returns no_ga_data when get_ga_summary finds no completed sync", async () => {
    const db = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [] };
          },
        };
        return stmt;
      },
    };

    const result = await executeTool(db as never, "get_ga_summary", {});

    expect(result).toEqual({ error: "no_ga_data" });
  });
});

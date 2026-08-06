import type { D1Database } from "./_d1";
import {
  computeListingMovers,
  computeShopOverview,
  computeStabilityMetrics,
  computeTopListings,
} from "./_intelligenceQueries";
import { getListingPerformance } from "../listings/_performance";
import { loadMonthlyStats } from "../etsy-stats/_db";
import { loadShopEvents } from "../shop-events/_db";
import { isSummaryRange, loadGaSummary } from "../analytics/_summary";
import { createMemory, loadMemories, updateMemory } from "./memories/_db";
import { MEMORY_TYPES, isMemoryType } from "./memories/_validation";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

const MONTH_PROPERTY = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}$",
  description: "Target month as YYYY-MM. Defaults to the last completed month if omitted.",
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_shop_overview",
      description:
        "Get the shop's headline status for a month: order count, Gross Sales, Net Revenue and True Net (USD) vs previous period/year, plus sales stability. Use this first for any 'how is the shop doing' question. IMPORTANT: netRevenueUsd is after the Etsy payment processing fee ONLY — it is not profit. trueNetUsd is what the shop actually keeps: it also subtracts advertising (adSpendUsd, charged daily against the Etsy balance) and otherEtsyCostsUsd (commission, listing renewals, VAT, and the net effect of refunds). Quote trueNetUsd for any question about profit or what is left over; quote netRevenueUsd only when asked about Etsy payment fees specifically, and say which one you used.",
      parameters: { type: "object", properties: { month: MONTH_PROPERTY } },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_periods",
      description:
        "Compare orders, Gross Sales, Net Revenue and True Net for a month against the previous period and the same period last year. A narrower version of get_shop_overview without stability details. The same caveat applies: netRevenueUsd is after payment fees only, trueNetUsd is what the shop keeps after advertising and every other Etsy cost.",
      parameters: { type: "object", properties: { month: MONTH_PROPERTY } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stability_metrics",
      description:
        "Get sales stability details for a month: daily average orders, active-day rate, zero-sale days, longest zero-sale streak, and whether the 3-5 orders/day target band is being met.",
      parameters: { type: "object", properties: { month: MONTH_PROPERTY } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_listings",
      description:
        "Get the top listings for a month ranked by distinct order count, with units sold, Gross Sales (USD), and the change vs the previous period.",
      parameters: {
        type: "object",
        properties: {
          month: MONTH_PROPERTY,
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Defaults to 5." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_listing_movers",
      description:
        "Get which listing lost the most orders and which gained the most orders in a month vs the previous period, plus counts of declining/growing listings. Use this to explain WHY sales changed.",
      parameters: { type: "object", properties: { month: MONTH_PROPERTY } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_listing_performance",
      description:
        "Get all-time performance for one specific listing: total orders, total units sold, total Gross Sales (USD), and first/last order date.",
      parameters: {
        type: "object",
        properties: {
          listingId: { type: "string", description: "The numeric Etsy listing ID." },
        },
        required: ["listingId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monthly_etsy_stats",
      description:
        "Get manually-entered Etsy Shop Stats for a month (visits, orders, conversion rate, Etsy-reported revenue, favorites, follows, reviews, repeat buyers, abandoned carts). This is separate from CSV-derived sales data.",
      parameters: { type: "object", properties: { month: MONTH_PROPERTY } },
    },
  },
  {
    type: "function",
    function: {
      name: "get_traffic_source_changes",
      description:
        "Compare Etsy traffic source visits (search, ads, social, direct, etc.) between two months, using manually-entered Etsy Stats. Returns null/warning if a month's Stats have not been entered yet.",
      parameters: {
        type: "object",
        properties: {
          month: MONTH_PROPERTY,
          compareMonth: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}$",
            description: "Defaults to the previous calendar month.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ga_summary",
      description:
        "Get Google Analytics site traffic from the D1 GA sync (active users, sessions, page views, daily trend, traffic channels, top pages, countries, devices, events). This is NOT Etsy Shop Stats and must NOT be used for sales attribution. Daily KPIs use range (30d/90d/180d/365d); channel/page/country/device/event breakdowns cover the last sync window only.",
      parameters: {
        type: "object",
        properties: {
          range: {
            type: "string",
            enum: ["30d", "90d", "180d", "365d"],
            description: "Lookback for daily KPIs and trend. Defaults to 90d.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_shop_events",
      description:
        "Get Shop Journal events (listing title/SEO/price/description changes, discount start/end, new listings) optionally filtered by listing, event type, or date range. Use this to check what changed before a sales shift.",
      parameters: {
        type: "object",
        properties: {
          listingId: { type: "string" },
          eventType: {
            type: "string",
            enum: [
              "new_listing",
              "title_change",
              "seo_change",
              "description_change",
              "alt_text_change",
              "price_change",
              "discount_start",
              "discount_rate_change",
              "discount_end",
              "manual_note",
            ],
          },
          dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          dateTo: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_relevant_memories",
      description:
        "Get the user's saved memory entries (goal, preference, decision, experiment, result, avoid_suggestion, shop_info), optionally filtered by type and/or a keyword match on content. Use this to recall relevant context before answering, and before save_memory to check whether an entry on the same topic already exists.",
      parameters: {
        type: "object",
        properties: {
          memoryType: { type: "string", enum: [...MEMORY_TYPES] },
          keyword: { type: "string", description: "Optional keyword to match against memory content." },
          limit: { type: "integer", minimum: 1, maximum: 8, description: "Defaults to 8." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Save a durable memory entry. Call this ONLY when the user explicitly asks to remember, save, or note something (e.g. \"hafızaya ekle\", \"not al\", \"kaydet\") -- never on your own judgment. Pass updateMemoryId to overwrite an existing entry on the same topic instead of creating a duplicate.",
      parameters: {
        type: "object",
        properties: {
          memoryType: { type: "string", enum: [...MEMORY_TYPES] },
          content: { type: "string", description: "Short memory text." },
          importance: { type: "string" },
          updateMemoryId: {
            type: "integer",
            description: "If set, overwrite this existing memory instead of creating a new one.",
          },
        },
        required: ["memoryType", "content"],
      },
    },
  },
];

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.function.name));

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

function readMonth(args: Record<string, unknown>): string | undefined {
  return typeof args.month === "string" ? args.month : undefined;
}

async function shiftMonth(month: string, offset: number): Promise<string> {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function executeTool(
  db: D1Database,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const args = typeof rawArgs === "object" && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {};

  switch (name) {
    case "get_shop_overview":
      return computeShopOverview(db, readMonth(args));

    case "compare_periods": {
      const overview = await computeShopOverview(db, readMonth(args));
      if ("error" in overview) {
        return overview;
      }
      return {
        month: overview.month,
        range: overview.range,
        orders: overview.orders,
        grossSalesUsd: overview.grossSalesUsd,
        netRevenueUsd: overview.netRevenueUsd,
        adSpendUsd: overview.adSpendUsd,
        otherEtsyCostsUsd: overview.otherEtsyCostsUsd,
        trueNetUsd: overview.trueNetUsd,
        source: overview.source,
        warnings: overview.warnings,
      };
    }

    case "get_stability_metrics":
      return computeStabilityMetrics(db, readMonth(args));

    case "get_top_listings": {
      const limit = typeof args.limit === "number" ? args.limit : 5;
      return computeTopListings(db, readMonth(args), limit);
    }

    case "get_listing_movers":
      return computeListingMovers(db, readMonth(args));

    case "get_listing_performance": {
      const listingId = typeof args.listingId === "string" ? args.listingId.trim() : "";
      if (!listingId) {
        return { error: "listingId_required" };
      }
      return getListingPerformance(db, listingId);
    }

    case "get_monthly_etsy_stats": {
      const month = readMonth(args);
      const records = await loadMonthlyStats(db, month);
      if (records.length === 0) {
        return { error: "no_stats_for_month", month: month ?? null };
      }
      return records[0];
    }

    case "get_traffic_source_changes": {
      const month = readMonth(args);
      const records = await loadMonthlyStats(db);
      if (records.length === 0) {
        return { error: "no_stats_available" };
      }
      const targetMonth = month ?? records[0].month;
      const current = records.find((record) => record.month === targetMonth);
      if (!current) {
        return { error: "no_stats_for_month", month: targetMonth };
      }
      const compareMonth =
        typeof args.compareMonth === "string"
          ? args.compareMonth
          : await shiftMonth(targetMonth, -1);
      const previous = records.find((record) => record.month === compareMonth);

      return {
        month: targetMonth,
        compareMonth,
        current: current.trafficSources,
        previous: previous?.trafficSources ?? null,
        warnings: previous ? [] : [`No Etsy Stats entered for ${compareMonth}.`],
        source: "etsy_monthly_traffic_sources",
      };
    }

    case "get_ga_summary": {
      const range = isSummaryRange(args.range) ? args.range : "90d";
      const summary = await loadGaSummary(db, range, { breakdownLimit: 10 });
      if (!summary) {
        return { error: "no_ga_data" };
      }
      return summary;
    }

    case "get_shop_events": {
      const events = await loadShopEvents(db, {
        listingId: typeof args.listingId === "string" ? args.listingId : undefined,
        eventType: typeof args.eventType === "string" ? args.eventType : undefined,
        dateFrom: typeof args.dateFrom === "string" ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
      });
      return { events: events.slice(0, 25), source: "shop_events" };
    }

    case "get_relevant_memories": {
      const memoryType = isMemoryType(args.memoryType) ? args.memoryType : undefined;
      const keyword = typeof args.keyword === "string" ? args.keyword : undefined;
      const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 8) : 8;
      const memories = await loadMemories(db, { memoryType, keyword, limit });
      return { memories, source: "ai_memories" };
    }

    case "save_memory": {
      const memoryType = args.memoryType;
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!isMemoryType(memoryType) || !content) {
        return { error: "invalid_memory_input" };
      }
      const importance = typeof args.importance === "string" ? args.importance : null;
      const updateMemoryId =
        typeof args.updateMemoryId === "number" ? args.updateMemoryId : undefined;

      if (updateMemoryId) {
        const updated = await updateMemory(db, updateMemoryId, { memoryType, content, importance });
        if (!updated) {
          return { error: "memory_not_found", id: updateMemoryId };
        }
        return { memory: updated, action: "updated" };
      }

      const created = await createMemory(db, { memoryType, content, importance }, "ai");
      return { memory: created, action: "created" };
    }

    default:
      return { error: "unknown_tool", tool: name };
  }
}

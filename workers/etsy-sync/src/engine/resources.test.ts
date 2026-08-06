import { describe, expect, it } from "vitest";
import { resourcesFor } from "./resources";

describe("public Etsy resource graph", () => {
  it("expands commerce resources once in dependency order", () => {
    const resources = resourcesFor("commerce");
    expect(resources).toEqual([
      "shop",
      "receipts",
      "payments",
      "ledger_entries",
    ]);
    expect(new Set(resources).size).toBe(resources.length);
    expect(resources.indexOf("shop")).toBeLessThan(resources.indexOf("receipts"));
    expect(resources.indexOf("receipts")).toBeLessThan(
      resources.indexOf("payments"),
    );
    expect(resources.indexOf("payments")).toBeLessThan(
      resources.indexOf("ledger_entries"),
    );
  });

  it("includes prerequisites in individual public syncs", () => {
    expect(resourcesFor("listings")).toEqual([
      "shop",
      "listings",
      "listing_inventory",
      "listing_files",
      "snapshots",
    ]);
    expect(resourcesFor("reviews")).toEqual(["shop", "reviews"]);
    expect(resourcesFor("shop")).toEqual(["shop", "shop_sections"]);
  });
});

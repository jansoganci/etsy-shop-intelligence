import { describe, expect, it } from "vitest";
import { deriveCommerceStage } from "./index";

describe("deriveCommerceStage", () => {
  it("labels each commerce resource state", () => {
    expect(deriveCommerceStage([])).toBe("queued");
    expect(
      deriveCommerceStage([
        { resource: "shop", status: "running" },
        { resource: "receipts", status: "pending" },
      ]),
    ).toBe("shop");
    expect(
      deriveCommerceStage([
        { resource: "shop", status: "completed" },
        { resource: "receipts", status: "queued" },
        { resource: "payments", status: "pending" },
      ]),
    ).toBe("receipts");
    expect(
      deriveCommerceStage([
        { resource: "shop", status: "completed" },
        { resource: "receipts", status: "completed" },
        { resource: "payments", status: "running" },
        { resource: "ledger_entries", status: "pending" },
      ]),
    ).toBe("payments");
    expect(
      deriveCommerceStage([
        { resource: "shop", status: "completed" },
        { resource: "receipts", status: "completed" },
        { resource: "payments", status: "completed" },
        { resource: "ledger_entries", status: "queued" },
      ]),
    ).toBe("ledger");
    expect(
      deriveCommerceStage([
        { resource: "shop", status: "completed" },
        { resource: "receipts", status: "completed" },
        { resource: "payments", status: "completed" },
        { resource: "ledger_entries", status: "completed" },
      ]),
    ).toBe("finishing");
  });
});

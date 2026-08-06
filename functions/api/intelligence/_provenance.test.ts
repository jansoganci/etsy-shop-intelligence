import { describe, expect, it } from "vitest";
import { aggregateProvenance } from "./_provenance";

describe("aggregateProvenance", () => {
  it("returns the single source when all rows match", () => {
    expect(aggregateProvenance(["etsy_api", "etsy_api"])).toBe("etsy_api");
    expect(aggregateProvenance(["csv_upload"])).toBe("csv_upload");
    expect(aggregateProvenance(["etsy_api+csv", "etsy_api+csv"])).toBe("etsy_api+csv");
  });

  it("returns mixed when more than one provenance value is present", () => {
    expect(aggregateProvenance(["etsy_api", "csv_upload"])).toBe("mixed");
    expect(aggregateProvenance(["etsy_api+csv", "etsy_api"])).toBe("mixed");
  });

  it("ignores null and unknown values", () => {
    expect(aggregateProvenance([null, "", "legacy_mirror"])).toBeNull();
    expect(aggregateProvenance(["etsy_api", null, ""])).toBe("etsy_api");
  });
});

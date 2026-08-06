import { describe, expect, it } from "vitest";
import {
  DEFAULT_ISSUE_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  MAX_ISSUE_PAGE_SIZE,
  clampRangeToPeriod,
  isValidIssueRequest,
  loadAllIssuesForExport,
  loadIssuePage,
  resolvePageSize,
  toCsv,
  type IssueRecord,
} from "./_issues";

describe("isValidIssueRequest", () => {
  it("accepts every documented entity/type combination", () => {
    expect(isValidIssueRequest("orders", "missing_in_api")).toBe(true);
    expect(isValidIssueRequest("orders", "missing_in_csv")).toBe(true);
    expect(isValidIssueRequest("orderItems", "orphan_api")).toBe(true);
    expect(isValidIssueRequest("orderItems", "orphan_csv")).toBe(true);
    expect(isValidIssueRequest("orderItems", "parent_mismatch")).toBe(true);
    expect(isValidIssueRequest("payments", "parent_mismatch")).toBe(true);
  });

  it("rejects orphan/parent_mismatch for orders, which has no parent of its own", () => {
    expect(isValidIssueRequest("orders", "orphan_api")).toBe(false);
    expect(isValidIssueRequest("orders", "orphan_csv")).toBe(false);
    expect(isValidIssueRequest("orders", "parent_mismatch")).toBe(false);
  });

  it("rejects an unknown entity or type entirely", () => {
    expect(isValidIssueRequest("listings", "missing_in_api")).toBe(false);
    expect(isValidIssueRequest("orders", "something_else")).toBe(false);
    expect(isValidIssueRequest("", "")).toBe(false);
  });
});

describe("resolvePageSize", () => {
  it("uses the default when nothing is requested", () => {
    expect(resolvePageSize(null)).toBe(DEFAULT_ISSUE_PAGE_SIZE);
    expect(resolvePageSize(undefined)).toBe(DEFAULT_ISSUE_PAGE_SIZE);
    expect(resolvePageSize(Number.NaN)).toBe(DEFAULT_ISSUE_PAGE_SIZE);
  });

  it("rejects zero or negative requested sizes back to the default", () => {
    expect(resolvePageSize(0)).toBe(DEFAULT_ISSUE_PAGE_SIZE);
    expect(resolvePageSize(-10)).toBe(DEFAULT_ISSUE_PAGE_SIZE);
  });

  it("clamps a requested size above the maximum instead of trusting the caller", () => {
    expect(resolvePageSize(10_000)).toBe(MAX_ISSUE_PAGE_SIZE);
  });

  it("floors a fractional request and passes a reasonable size through unchanged", () => {
    expect(resolvePageSize(25.9)).toBe(25);
    expect(resolvePageSize(100)).toBe(100);
  });
});

// -----------------------------------------------------------------------
// loadIssuePage: pagination and PII-shape behavior against a fake D1 that
// returns canned rows, so this is testable without a real database.
// -----------------------------------------------------------------------

function fakeDb(rows: IssueRecord[]) {
  return {
    prepare: () => ({
      bind: (..._args: unknown[]) => ({
        all: async <T,>() => ({ results: rows as unknown as T[] }),
        first: async <T,>() => (rows[0] as unknown as T) ?? null,
      }),
    }),
  };
}

describe("loadIssuePage", () => {
  it("2. multiple payment records paginate correctly: hasMore is true when more rows exist than the page size", async () => {
    // Simulates "Multiple payment" (doc Faz5 test list): more problem
    // records exist than fit on one page.
    const rows: IssueRecord[] = Array.from({ length: 6 }, (_, i) => ({
      id: `pay_${i}`,
      date: "2026-06-01",
      amount: 10,
      currency: "USD",
    }));
    const db = fakeDb(rows); // 6 rows returned for a page size of 5 (5+1 fetched)
    const page = await loadIssuePage(
      db as never,
      "payments",
      "missing_in_csv",
      { min: "2026-01-01", max: "2026-12-31" },
      5,
      0,
    );
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
  });

  it("hasMore is false when exactly the page size (or fewer) rows come back", async () => {
    const rows: IssueRecord[] = [{ id: "pay_1", date: "2026-06-01", amount: 10, currency: "USD" }];
    const db = fakeDb(rows);
    const page = await loadIssuePage(
      db as never,
      "payments",
      "missing_in_csv",
      { min: "2026-01-01", max: "2026-12-31" },
      5,
      0,
    );
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  it("3. parent mismatch rows carry a detail field showing both parents, with no PII field ever present", async () => {
    const rows: IssueRecord[] = [
      { id: "t1", date: "2026-06-01", amount: 25, currency: "USD", detail: "API parent r1 vs CSV parent r2" },
    ];
    const db = fakeDb(rows);
    const page = await loadIssuePage(
      db as never,
      "orderItems",
      "parent_mismatch",
      { min: "2026-01-01", max: "2026-12-31" },
      50,
      0,
    );
    const [item] = page.items;
    expect(item.detail).toBe("API parent r1 vs CSV parent r2");
    expect(Object.keys(item).sort()).toEqual(["amount", "currency", "date", "detail", "id"].sort());
  });

  it("4. orphan queries return an empty page cleanly when nothing is orphaned", async () => {
    const db = fakeDb([]);
    const page = await loadIssuePage(
      db as never,
      "orderItems",
      "orphan_api",
      { min: null, max: null },
      50,
      0,
    );
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("an entity/type combination with no query (e.g. orders parent_mismatch, guarded elsewhere) returns an empty page instead of throwing", async () => {
    const db = fakeDb([{ id: "x", date: null, amount: null, currency: null }]);
    const page = await loadIssuePage(db as never, "orders", "orphan_api", { min: null, max: null }, 50, 0);
    expect(page.items).toEqual([]);
  });

  it("applies the selected period to every supported issue query, including orphan and parent mismatch", async () => {
    const range = { min: "2026-03-01", max: "2026-03-31" };
    const combinations = [
      ["orders", "missing_in_api"],
      ["orders", "missing_in_csv"],
      ["orderItems", "missing_in_api"],
      ["orderItems", "missing_in_csv"],
      ["orderItems", "orphan_api"],
      ["orderItems", "orphan_csv"],
      ["orderItems", "parent_mismatch"],
      ["payments", "missing_in_api"],
      ["payments", "missing_in_csv"],
      ["payments", "orphan_api"],
      ["payments", "orphan_csv"],
      ["payments", "parent_mismatch"],
    ] as const;

    for (const [entity, type] of combinations) {
      let bound: unknown[] = [];
      const db = {
        prepare: () => ({
          bind: (...values: unknown[]) => {
            bound = values;
            return { all: async <T,>() => ({ results: [] as T[] }) };
          },
        }),
      };
      await loadIssuePage(db as never, entity, type, range, 25, 0);
      expect(bound, `${entity}/${type}`).toContain(range.min);
      expect(bound, `${entity}/${type}`).toContain(range.max);
    }
  });
});

// -----------------------------------------------------------------------
// Phase 6: period filter, export.
// -----------------------------------------------------------------------

describe("clampRangeToPeriod", () => {
  const base = { min: "2026-01-01", max: "2026-12-31" };

  it("narrows the base range when both from and to fall inside it", () => {
    expect(clampRangeToPeriod(base, "2026-03-01", "2026-06-30")).toEqual({
      min: "2026-03-01",
      max: "2026-06-30",
    });
  });

  it("ignores a `from` that is earlier than the base range (never widens past it)", () => {
    expect(clampRangeToPeriod(base, "2020-01-01", null)).toEqual({ min: "2026-01-01", max: "2026-12-31" });
  });

  it("ignores a `to` that is later than the base range (never widens past it)", () => {
    expect(clampRangeToPeriod(base, null, "2030-01-01")).toEqual({ min: "2026-01-01", max: "2026-12-31" });
  });

  it("passes the base range through unchanged when no period filter is given", () => {
    expect(clampRangeToPeriod(base, null, null)).toEqual(base);
    expect(clampRangeToPeriod(base, undefined, undefined)).toEqual(base);
  });

  it("a from/to pair outside the base range (no overlap) collapses to an empty range", () => {
    expect(clampRangeToPeriod(base, "2027-01-01", "2027-06-30")).toEqual({ min: null, max: null });
  });

  it("an already-empty base range is returned as-is", () => {
    expect(clampRangeToPeriod({ min: null, max: null }, "2026-01-01", "2026-06-30")).toEqual({
      min: null,
      max: null,
    });
  });
});

describe("toCsv", () => {
  it("produces a header row plus one row per item, in the documented column order", () => {
    const csv = toCsv([{ id: "r1", date: "2026-06-01", amount: 12.5, currency: "USD" }]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,date,amount,currency,detail");
    expect(lines[1]).toBe("r1,2026-06-01,12.5,USD,");
  });

  it("never includes a PII column: only the five allowlisted fields ever appear", () => {
    const csv = toCsv([{ id: "r1", date: "2026-06-01", amount: 12.5, currency: "USD", detail: "note" }]);
    expect(csv.split("\n")[0].split(",")).toEqual(["id", "date", "amount", "currency", "detail"]);
  });

  it("quotes and escapes a detail field containing a comma", () => {
    const csv = toCsv([
      { id: "r1", date: null, amount: null, currency: null, detail: "API parent r1, CSV parent r2" },
    ]);
    expect(csv).toContain('"API parent r1, CSV parent r2"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    const csv = toCsv([{ id: "r1", date: null, amount: null, currency: null, detail: 'say "hi"' }]);
    expect(csv).toContain('"say ""hi"""');
  });

  it("neutralizes spreadsheet formula injection in exported cells", () => {
    const csv = toCsv([
      { id: "=1+1", date: null, amount: null, currency: "+CMD", detail: "@SUM(A1:A2)" },
    ]);
    expect(csv.split("\n")[1]).toBe("'=1+1,,,'+CMD,'@SUM(A1:A2)");
  });

  it("renders null fields as empty cells, not the literal string null", () => {
    const csv = toCsv([{ id: "r1", date: null, amount: null, currency: null }]);
    expect(csv.split("\n")[1]).toBe("r1,,,,");
  });

  it("an empty item list still produces just the header row", () => {
    expect(toCsv([])).toBe("id,date,amount,currency,detail");
  });
});

describe("loadAllIssuesForExport", () => {
  it("5. export content matches what the on-screen list would show for the same filters: paginates internally and concatenates every row", async () => {
    let call = 0;
    const pages = [
      // loadIssuePage fetches limit+1 rows to detect hasMore; returning
      // exactly that many here signals "there is a next page".
      Array.from({ length: MAX_ISSUE_PAGE_SIZE + 1 }, (_, i) => ({
        id: `r${i}`,
        date: "2026-06-01",
        amount: 1,
        currency: "USD",
      })),
      [{ id: "last", date: "2026-06-02", amount: 2, currency: "USD" }],
    ];
    const db = {
      prepare: () => ({
        bind: (..._args: unknown[]) => ({
          all: async <T,>() => {
            const rows = pages[call] ?? [];
            call += 1;
            return { results: rows as unknown as T[] };
          },
        }),
      }),
    };
    const items = await loadAllIssuesForExport(
      db as never,
      "payments",
      "missing_in_csv",
      { min: "2026-01-01", max: "2026-12-31" },
    );
    expect(items).toHaveLength(MAX_ISSUE_PAGE_SIZE + 1);
    expect(items[items.length - 1].id).toBe("last");
  });

  it("never returns more than MAX_EXPORT_ROWS even if more pages exist (large-export risk guard)", async () => {
    // Always returns one row beyond the page size, so hasMore is true on
    // every single page -- without the MAX_EXPORT_ROWS cap this would page
    // forever.
    const db = {
      prepare: () => ({
        bind: (..._args: unknown[]) => ({
          all: async <T,>() => ({
            results: Array.from({ length: MAX_ISSUE_PAGE_SIZE + 1 }, (_, i) => ({
              id: `r${i}`,
              date: "2026-06-01",
              amount: 1,
              currency: "USD",
            })) as unknown as T[],
          }),
        }),
      }),
    };
    const items = await loadAllIssuesForExport(
      db as never,
      "payments",
      "missing_in_csv",
      { min: "2026-01-01", max: "2026-12-31" },
    );
    expect(items).toHaveLength(MAX_EXPORT_ROWS);
  });
});

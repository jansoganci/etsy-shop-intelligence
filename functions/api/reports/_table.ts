interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export type SortDirection = "asc" | "desc";

export type TableRequestContext = {
  request: Request;
  env: {
    DB: D1Database;
  };
};

type FilterValue = string | number | null;

type TableConfig = {
  viewName?: string;
  fromSql?: string;
  defaultSortBy: string;
  defaultSortDir?: SortDirection;
  sortableColumns: Record<string, string>;
  selectColumns: string[];
  filterColumns: {
    date?: string;
    country?: string;
    city?: string;
    couponCode?: string;
    currency?: string;
    orderId?: string;
    listingId?: string;
    status?: string;
    q?: string[];
  };
};

type CountRow = {
  totalRows: number | null;
};

function clampInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseSortDir(value: string | null | undefined, fallback: SortDirection): SortDirection {
  return value?.toLowerCase() === "asc" ? "asc" : value?.toLowerCase() === "desc" ? "desc" : fallback;
}

function normalizeStringFilter(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return value;
}

export async function handleTableRequest(
  context: TableRequestContext,
  config: TableConfig,
): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const page = clampInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = clampInteger(url.searchParams.get("pageSize"), 25, 1, 200);
    const requestedSortBy = normalizeStringFilter(url.searchParams.get("sortBy"));
    const sortBy = requestedSortBy && config.sortableColumns[requestedSortBy]
      ? requestedSortBy
      : config.defaultSortBy;
    const sortDir = parseSortDir(url.searchParams.get("sortDir"), config.defaultSortDir ?? "desc");
    const offset = (page - 1) * pageSize;

    const filters = {
      dateFrom: normalizeStringFilter(url.searchParams.get("dateFrom")),
      dateTo: normalizeStringFilter(url.searchParams.get("dateTo")),
      country: normalizeStringFilter(url.searchParams.get("country")),
      city: normalizeStringFilter(url.searchParams.get("city")),
      couponCode: normalizeStringFilter(url.searchParams.get("couponCode")),
      couponUsed: normalizeStringFilter(url.searchParams.get("couponUsed")),
      currency: normalizeStringFilter(url.searchParams.get("currency")),
      orderId: normalizeStringFilter(url.searchParams.get("orderId")),
      listingId: normalizeStringFilter(url.searchParams.get("listingId")),
      status: normalizeStringFilter(url.searchParams.get("status")),
      q: normalizeStringFilter(url.searchParams.get("q")),
    };

    const whereClauses: string[] = [];
    const bindings: FilterValue[] = [];

    if (config.filterColumns.date && filters.dateFrom) {
      whereClauses.push(`${config.filterColumns.date} >= ?`);
      bindings.push(filters.dateFrom);
    }

    if (config.filterColumns.date && filters.dateTo) {
      whereClauses.push(`${config.filterColumns.date} <= ?`);
      bindings.push(filters.dateTo);
    }

    if (config.filterColumns.country && filters.country) {
      whereClauses.push(`${config.filterColumns.country} = ?`);
      bindings.push(filters.country);
    }

    if (config.filterColumns.city && filters.city) {
      whereClauses.push(`${config.filterColumns.city} = ?`);
      bindings.push(filters.city);
    }

    if (config.filterColumns.couponCode && filters.couponCode) {
      whereClauses.push(`${config.filterColumns.couponCode} = ?`);
      bindings.push(filters.couponCode);
    }

    if (config.filterColumns.couponCode && filters.couponUsed === "true") {
      whereClauses.push(`${config.filterColumns.couponCode} IS NOT NULL AND TRIM(${config.filterColumns.couponCode}) <> ''`);
    }

    if (config.filterColumns.couponCode && filters.couponUsed === "false") {
      whereClauses.push(`(${config.filterColumns.couponCode} IS NULL OR TRIM(${config.filterColumns.couponCode}) = '')`);
    }

    if (config.filterColumns.currency && filters.currency) {
      whereClauses.push(`${config.filterColumns.currency} = ?`);
      bindings.push(filters.currency);
    }

    if (config.filterColumns.orderId && filters.orderId) {
      whereClauses.push(`${config.filterColumns.orderId} = ?`);
      bindings.push(filters.orderId);
    }

    if (config.filterColumns.listingId && filters.listingId) {
      whereClauses.push(`${config.filterColumns.listingId} = ?`);
      bindings.push(filters.listingId);
    }

    if (config.filterColumns.status && filters.status) {
      whereClauses.push(`${config.filterColumns.status} = ?`);
      bindings.push(filters.status);
    }

    if (config.filterColumns.q && filters.q) {
      const qClauses = config.filterColumns.q.map((column) => `${column} LIKE ?`);
      whereClauses.push(`(${qClauses.join(" OR ")})`);
      const likeValue = `%${filters.q}%`;
      for (let index = 0; index < config.filterColumns.q.length; index += 1) {
        bindings.push(likeValue);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const sortColumn = config.sortableColumns[sortBy];
    const selectSql = config.selectColumns.join(",\n          ");
    const fromSql = config.fromSql ?? config.viewName;
    if (!fromSql) {
      throw new Error("table_source_missing");
    }

    const countResult = await context.env.DB.prepare(
      `
        SELECT COUNT(*) AS totalRows
        FROM ${fromSql}
        ${whereSql}
      `,
    ).bind(...bindings).first<CountRow>();

    const rowResult = await context.env.DB.prepare(
      `
        SELECT
          ${selectSql}
        FROM ${fromSql}
        ${whereSql}
        ORDER BY ${sortColumn} ${sortDir.toUpperCase()}
        LIMIT ?
        OFFSET ?
      `,
    ).bind(...bindings, pageSize, offset).all<Record<string, unknown>>();

    const totalRows = toNumber(countResult?.totalRows);
    const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 0;

    return Response.json({
      ok: true,
      rows: rowResult.results ?? [],
      page,
      pageSize,
      totalRows,
      totalPages,
      sortBy,
      sortDir,
      filters,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: "report_table_failed",
      },
      { status: 500 },
    );
  }
}

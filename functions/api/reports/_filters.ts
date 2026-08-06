export type ReportCompareMode = "previous_period" | "previous_year" | "none";

export type ParsedReportFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  country: string | null;
  city: string | null;
  currency: string | null;
  couponUsed: boolean | null;
  couponCode: string | null;
  status: string | null;
  orderId: string | null;
  listingId: string | null;
  paymentId: string | null;
  q: string | null;
  compare: ReportCompareMode;
};

type FilterColumn = string | readonly string[];

type FilterColumns = {
  date?: string;
  country?: string;
  city?: string;
  currency?: FilterColumn;
  couponCode?: string;
  status?: string;
  orderId?: string;
  listingId?: string;
  paymentId?: string;
  q?: readonly string[];
};

type ParseOptions = {
  supportedFilters?: Array<keyof Omit<ParsedReportFilters, "compare">>;
};

type BuildOptions = {
  columns: FilterColumns;
};

function normalizeString(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseCouponUsed(value: string | null): boolean | null {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === null) {
    return null;
  }

  throw new Error("invalid_coupon_used");
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateDate(value: string | null, fieldName: "dateFrom" | "dateTo"): string | null {
  if (!value) {
    return null;
  }

  if (!isIsoDate(value)) {
    throw new Error(`invalid_${fieldName}`);
  }

  return value;
}

function parseCompare(value: string | null, hasDateRange: boolean): ReportCompareMode {
  if (!value) {
    return hasDateRange ? "previous_period" : "none";
  }

  if (value === "previous_period" || value === "previous_year" || value === "none") {
    return value;
  }

  throw new Error("invalid_compare");
}

export function parseReportFilters(request: Request, options: ParseOptions = {}): ParsedReportFilters {
  const url = new URL(request.url);
  const supported = new Set(options.supportedFilters ?? [
    "dateFrom",
    "dateTo",
    "country",
    "city",
    "currency",
    "couponUsed",
    "couponCode",
    "status",
    "orderId",
    "listingId",
    "paymentId",
    "q",
  ]);

  const dateFrom = supported.has("dateFrom")
    ? validateDate(normalizeString(url.searchParams.get("dateFrom")), "dateFrom")
    : null;
  const dateTo = supported.has("dateTo")
    ? validateDate(normalizeString(url.searchParams.get("dateTo")), "dateTo")
    : null;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error("invalid_date_range");
  }

  const hasDateRange = Boolean(dateFrom || dateTo);

  return {
    dateFrom,
    dateTo,
    country: supported.has("country") ? normalizeString(url.searchParams.get("country")) : null,
    city: supported.has("city") ? normalizeString(url.searchParams.get("city")) : null,
    currency: supported.has("currency") ? normalizeString(url.searchParams.get("currency")) : null,
    couponUsed: supported.has("couponUsed") ? parseCouponUsed(normalizeString(url.searchParams.get("couponUsed"))) : null,
    couponCode: supported.has("couponCode") ? normalizeString(url.searchParams.get("couponCode")) : null,
    status: supported.has("status") ? normalizeString(url.searchParams.get("status")) : null,
    orderId: supported.has("orderId") ? normalizeString(url.searchParams.get("orderId")) : null,
    listingId: supported.has("listingId") ? normalizeString(url.searchParams.get("listingId")) : null,
    paymentId: supported.has("paymentId") ? normalizeString(url.searchParams.get("paymentId")) : null,
    q: supported.has("q") ? normalizeString(url.searchParams.get("q")) : null,
    compare: parseCompare(normalizeString(url.searchParams.get("compare")), hasDateRange),
  };
}

function addEqualityFilter(
  whereClauses: string[],
  bindings: Array<string | number>,
  column: FilterColumn | undefined,
  value: string | null,
) {
  if (!column || !value) {
    return;
  }

  if (Array.isArray(column)) {
    whereClauses.push(`(${column.map((entry) => `${entry} = ?`).join(" OR ")})`);
    for (const entry of column) {
      bindings.push(value);
    }
    return;
  }

  whereClauses.push(`${column} = ?`);
  bindings.push(value);
}

/**
 * Payment financial metrics use payments.order_date for the date range, and
 * carry order dimensions (country, city, coupon, status, currency, order ID,
 * search) through the related order — without substituting orders.sale_date
 * for the payment date.
 */
export function buildPaymentFinancialWhere(
  filters: ParsedReportFilters,
  orderColumns: FilterColumns,
): {
  whereSql: string;
  bindings: Array<string | number>;
} {
  const dimensionFilters: ParsedReportFilters = {
    ...filters,
    dateFrom: null,
    dateTo: null,
  };
  const orderWhere = buildReportWhere(dimensionFilters, { columns: orderColumns });

  const clauses: string[] = [];
  const bindings: Array<string | number> = [];

  if (filters.dateFrom) {
    clauses.push("order_date >= ?");
    bindings.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    clauses.push("order_date <= ?");
    bindings.push(filters.dateTo);
  }

  clauses.push(
    `order_id IN (SELECT order_id FROM v_orders_canonical${
      orderWhere.whereSql ? ` ${orderWhere.whereSql}` : ""
    })`,
  );
  bindings.push(...orderWhere.bindings);

  return {
    whereSql: `WHERE ${clauses.join(" AND ")}`,
    bindings,
  };
}

export function buildReportWhere(filters: ParsedReportFilters, options: BuildOptions): {
  whereSql: string;
  bindings: Array<string | number>;
} {
  const whereClauses: string[] = [];
  const bindings: Array<string | number> = [];
  const { columns } = options;

  if (columns.date && filters.dateFrom) {
    whereClauses.push(`${columns.date} >= ?`);
    bindings.push(filters.dateFrom);
  }

  if (columns.date && filters.dateTo) {
    whereClauses.push(`${columns.date} <= ?`);
    bindings.push(filters.dateTo);
  }

  addEqualityFilter(whereClauses, bindings, columns.country, filters.country);
  addEqualityFilter(whereClauses, bindings, columns.city, filters.city);
  addEqualityFilter(whereClauses, bindings, columns.currency, filters.currency);
  addEqualityFilter(whereClauses, bindings, columns.couponCode, filters.couponCode);
  addEqualityFilter(whereClauses, bindings, columns.status, filters.status);
  addEqualityFilter(whereClauses, bindings, columns.orderId, filters.orderId);
  addEqualityFilter(whereClauses, bindings, columns.listingId, filters.listingId);
  addEqualityFilter(whereClauses, bindings, columns.paymentId, filters.paymentId);

  if (columns.couponCode && filters.couponUsed === true) {
    whereClauses.push(`${columns.couponCode} IS NOT NULL AND TRIM(${columns.couponCode}) <> ''`);
  }

  if (columns.couponCode && filters.couponUsed === false) {
    whereClauses.push(`(${columns.couponCode} IS NULL OR TRIM(${columns.couponCode}) = '')`);
  }

  if (columns.q && filters.q) {
    whereClauses.push(`(${columns.q.map((column) => `${column} LIKE ?`).join(" OR ")})`);
    const likeValue = `%${filters.q}%`;
    for (const column of columns.q) {
      bindings.push(likeValue);
    }
  }

  return {
    whereSql: whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
    bindings,
  };
}

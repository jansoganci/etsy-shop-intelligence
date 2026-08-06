import type {
  OrderItemsTableRow,
  OrdersTableRow,
  PaymentsTableRow,
  ReportFilters,
  ReportSummaryResponse,
  ReportTableRequest,
  ReportTableResponse,
} from "../types/reports";

type ReportsApiFailure = {
  ok: false;
  error: string;
};

function buildQueryString<T extends object>(filters: T): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters) as Array<
    [string, string | number | boolean | null | undefined]
  >) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

async function fetchReportSummary(
  endpoint: string,
  filters: ReportFilters,
): Promise<ReportSummaryResponse> {
  let response: Response;

  try {
    response = await fetch(`${endpoint}${buildQueryString(filters)}`);
  } catch {
    throw new Error("Network error while loading report summary.");
  }

  let data: ReportSummaryResponse | ReportsApiFailure;

  try {
    data = (await response.json()) as ReportSummaryResponse | ReportsApiFailure;
  } catch {
    throw new Error("Report summary API returned an invalid response.");
  }

  if (!response.ok || "ok" in data) {
    throw new Error("Failed to load report summary.");
  }

  return data;
}

async function fetchReportTable<TRow>(
  endpoint: string,
  request: ReportTableRequest,
): Promise<ReportTableResponse<TRow>> {
  let response: Response;

  try {
    response = await fetch(`${endpoint}${buildQueryString(request)}`);
  } catch {
    throw new Error("Network error while loading report table.");
  }

  let data: ReportTableResponse<TRow> | ReportsApiFailure;

  try {
    data = (await response.json()) as ReportTableResponse<TRow> | ReportsApiFailure;
  } catch {
    throw new Error("Report table API returned an invalid response.");
  }

  if (!response.ok || "ok" in data === false || ("ok" in data && data.ok === false)) {
    throw new Error("Failed to load report table.");
  }

  return data;
}

export function getOrdersSummary(filters: ReportFilters = {}): Promise<ReportSummaryResponse> {
  return fetchReportSummary("/api/reports/orders/summary", filters);
}

export function getOrderItemsSummary(filters: ReportFilters = {}): Promise<ReportSummaryResponse> {
  return fetchReportSummary("/api/reports/order-items/summary", filters);
}

export function getPaymentsSummary(filters: ReportFilters = {}): Promise<ReportSummaryResponse> {
  return fetchReportSummary("/api/reports/payments/summary", filters);
}

export function getOrderItemsTable(
  request: ReportTableRequest = {},
): Promise<ReportTableResponse<OrderItemsTableRow>> {
  return fetchReportTable<OrderItemsTableRow>("/api/reports/order-items/table", request);
}

export function getOrdersTable(
  request: ReportTableRequest = {},
): Promise<ReportTableResponse<OrdersTableRow>> {
  return fetchReportTable<OrdersTableRow>("/api/reports/orders/table", request);
}

export function getPaymentsTable(
  request: ReportTableRequest = {},
): Promise<ReportTableResponse<PaymentsTableRow>> {
  return fetchReportTable<PaymentsTableRow>("/api/reports/payments/table", request);
}

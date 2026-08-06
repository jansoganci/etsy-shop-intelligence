import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Collapsible, EmptyState, LoadingState } from "../../../components/ui";
import { getPaymentsSummary, getPaymentsTable } from "../../../data/api/reports.api";
import type {
  PaymentsTableRow,
  ReportComparisonMode,
  ReportFilters,
  ReportSortDirection,
  ReportSummaryResponse,
  ReportTableResponse,
} from "../../../data/types/reports";
import {
  InsightBlockList,
  FinancialProvenanceStrip,
  KpiCard,
  KpiCardGrid,
  ReportChartCard,
  ReportFiltersBar,
  ReportPageLayout,
  ReportTableShell,
  ReportTabs,
  SimpleChartTable,
  asChartRows,
} from "../components";

type ReportTabId = "overview" | "table";

type FilterDraft = {
  dateFrom: string;
  dateTo: string;
  currency: string;
  status: string;
  orderId: string;
  paymentId: string;
  q: string;
  compare: ReportComparisonMode;
};

type PaymentsTableSortBy =
  | "paymentId"
  | "orderId"
  | "orderDate"
  | "paymentStatus"
  | "paymentCurrency"
  | "listingCurrency"
  | "grossAmount"
  | "fees"
  | "netAmount"
  | "refundAmount";

type TableState = {
  page: number;
  pageSize: number;
  sortBy: PaymentsTableSortBy;
  sortDir: ReportSortDirection;
};

const REPORT_TABS: Array<{ id: ReportTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "table", label: "Table" },
];

const DEFAULT_TABLE_STATE: TableState = {
  page: 1,
  pageSize: 25,
  sortBy: "orderDate",
  sortDir: "desc",
};

const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const SORTABLE_TABLE_COLUMNS: Array<{ key: PaymentsTableSortBy; label: string }> = [
  { key: "paymentId", label: "Payment ID" },
  { key: "orderId", label: "Order ID" },
  { key: "orderDate", label: "Payment Date" },
  { key: "grossAmount", label: "Gross Amount" },
  { key: "fees", label: "Fees" },
  { key: "netAmount", label: "Net Amount" },
  { key: "paymentCurrency", label: "Payment Currency" },
  { key: "listingCurrency", label: "Listing Currency" },
  { key: "refundAmount", label: "Refund Amount" },
  { key: "paymentStatus", label: "Status" },
];

const COMPARE_OPTIONS: Array<{ value: ReportComparisonMode; label: string }> = [
  { value: "none", label: "No comparison" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_year", label: "Previous year" },
];

function getInitialDraft(searchParams: URLSearchParams): FilterDraft {
  const compareValue = searchParams.get("compare");

  return {
    dateFrom: searchParams.get("dateFrom") ?? "",
    dateTo: searchParams.get("dateTo") ?? "",
    currency: searchParams.get("currency") ?? "",
    status: searchParams.get("status") ?? "",
    orderId: searchParams.get("orderId") ?? "",
    paymentId: searchParams.get("paymentId") ?? "",
    q: searchParams.get("q") ?? "",
    compare:
      compareValue === "previous_period" || compareValue === "previous_year" || compareValue === "none"
        ? compareValue
        : "none",
  };
}

function getFiltersFromDraft(draft: FilterDraft): ReportFilters {
  return {
    dateFrom: draft.dateFrom || undefined,
    dateTo: draft.dateTo || undefined,
    currency: draft.currency || undefined,
    status: draft.status || undefined,
    orderId: draft.orderId || undefined,
    paymentId: draft.paymentId || undefined,
    q: draft.q || undefined,
    compare: draft.compare,
  };
}

function clampPositiveInteger(value: string | null, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isSortBy(value: string | null): value is PaymentsTableSortBy {
  return SORTABLE_TABLE_COLUMNS.some((column) => column.key === value);
}

function getTableState(searchParams: URLSearchParams): TableState {
  const sortByParam = searchParams.get("sortBy");
  const sortDirParam = searchParams.get("sortDir");

  return {
    page: clampPositiveInteger(searchParams.get("page"), DEFAULT_TABLE_STATE.page),
    pageSize: clampPositiveInteger(searchParams.get("pageSize"), DEFAULT_TABLE_STATE.pageSize),
    sortBy: isSortBy(sortByParam) ? sortByParam : DEFAULT_TABLE_STATE.sortBy,
    sortDir: sortDirParam === "asc" ? "asc" : "desc",
  };
}

function buildSearchParams(
  draft: FilterDraft,
  activeTab: ReportTabId,
  tableState: TableState = DEFAULT_TABLE_STATE,
): URLSearchParams {
  const params = new URLSearchParams();
  const filters = getFiltersFromDraft(draft);

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === "none") {
      continue;
    }

    params.set(key, String(value));
  }

  if (activeTab !== "overview") {
    params.set("tab", activeTab);
  }

  if (activeTab === "table") {
    params.set("page", String(tableState.page));
    params.set("pageSize", String(tableState.pageSize));

    if (tableState.sortBy !== DEFAULT_TABLE_STATE.sortBy) {
      params.set("sortBy", tableState.sortBy);
    }

    if (tableState.sortDir !== DEFAULT_TABLE_STATE.sortDir) {
      params.set("sortDir", tableState.sortDir);
    }
  }

  return params;
}

function readActiveTab(searchParams: URLSearchParams): ReportTabId {
  return searchParams.get("tab") === "table" ? "table" : "overview";
}

function hasSummaryContent(summary: ReportSummaryResponse | null): boolean {
  if (!summary) {
    return false;
  }

  if (summary.kpis.length > 0 || summary.insights.length > 0 || summary.warnings.length > 0) {
    return true;
  }

  return Object.values(summary.charts ?? {}).some((value) => asChartRows(value).length > 0);
}

function buildTableRequest(filters: ReportFilters, tableState: TableState) {
  return {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    currency: filters.currency,
    status: filters.status,
    orderId: filters.orderId,
    // Payments table endpoint does not expose an exact paymentId filter; q remains the supported text search.
    q: filters.q || filters.paymentId,
    page: tableState.page,
    pageSize: tableState.pageSize,
    sortBy: tableState.sortBy,
    sortDir: tableState.sortDir,
  };
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatText(value: string | null): string {
  return value && value.trim() ? value : "—";
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return "—";
  }

  return `${currency ?? "—"} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function formatRate(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function PaymentsReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ReportTabId>(() => readActiveTab(searchParams));
  const [draft, setDraft] = useState<FilterDraft>(() => getInitialDraft(searchParams));
  const [summary, setSummary] = useState<ReportSummaryResponse | null>(null);
  const [tableResponse, setTableResponse] = useState<ReportTableResponse<PaymentsTableRow> | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isTableLoading, setIsTableLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const searchKey = searchParams.toString();
  const appliedDraft = useMemo(() => getInitialDraft(searchParams), [searchKey]);
  const appliedFilters = useMemo(() => getFiltersFromDraft(appliedDraft), [appliedDraft]);
  const tableState = useMemo(() => getTableState(searchParams), [searchKey]);

  useEffect(() => {
    setDraft(getInitialDraft(searchParams));
    setActiveTab(readActiveTab(searchParams));
  }, [searchParams]);

  useEffect(() => {
    let isCancelled = false;

    setIsSummaryLoading(true);
    setSummaryError(null);

    void getPaymentsSummary(appliedFilters)
      .then((result) => {
        if (!isCancelled) {
          setSummary(result);
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setSummaryError(
            fetchError instanceof Error ? fetchError.message : "Failed to load payments summary.",
          );
          setSummary(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsSummaryLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [appliedFilters]);

  useEffect(() => {
    if (activeTab !== "table") {
      return;
    }

    let isCancelled = false;

    setIsTableLoading(true);
    setTableError(null);

    void getPaymentsTable(buildTableRequest(appliedFilters, tableState))
      .then((result) => {
        if (!isCancelled) {
          setTableResponse(result);
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setTableError(
            fetchError instanceof Error ? fetchError.message : "Failed to load payments table.",
          );
          setTableResponse(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsTableLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, appliedFilters, tableState]);

  const rawDataSections = useMemo(
    () => [
      {
        key: "grossVsNetTrend",
        title: "Gross vs Net Trend",
        subtitle: "Gross, fee, and net payout values grouped by payment currency over time.",
        rows: asChartRows(summary?.charts?.grossVsNetTrend),
        emptyMessage: "No gross vs net trend data is available for the current filters.",
      },
      {
        key: "effectiveFeeRateOverTime",
        title: "Fee Rate Over Time",
        subtitle: "Effective fee-rate trend over time from the payments summary endpoint.",
        rows: asChartRows(summary?.charts?.effectiveFeeRateOverTime),
        emptyMessage: "No fee-rate trend data is available for the current filters.",
      },
      {
        key: "feesOverTime",
        title: "Fees Over Time",
        subtitle: "Total fees over time by payment currency.",
        rows: asChartRows(summary?.charts?.feesOverTime),
        emptyMessage: "No fees trend data is available for the current filters.",
      },
      {
        key: "refundTrend",
        title: "Refund Trend",
        subtitle: "Refund amounts and counts over time by payment currency.",
        rows: asChartRows(summary?.charts?.refundTrend),
        emptyMessage: "No refund trend data is available for the current filters.",
      },
    ],
    [summary],
  );

  const chartSections = useMemo(
    () => [
      {
        key: "listingAmountDistribution",
        title: "Listing Amount Distribution",
        subtitle: "Listing-amount distribution grouped by listing currency and price bucket.",
        rows: asChartRows(summary?.charts?.listingAmountDistribution),
        emptyMessage: "No listing amount distribution data is available for the current filters.",
      },
      {
        key: "exchangeRateTrend",
        title: "Exchange Rate Trend",
        subtitle: "Average and weighted exchange-rate trends over time.",
        rows: asChartRows(summary?.charts?.exchangeRateTrend),
        emptyMessage: "No exchange-rate trend data is available for the current filters.",
      },
      {
        key: "paymentStatusDistribution",
        title: "Payment Status Distribution",
        subtitle: "Payment status breakdown with payment counts and payout amounts.",
        rows: asChartRows(summary?.charts?.paymentStatusDistribution),
        emptyMessage: "No payment status distribution data is available for the current filters.",
      },
    ],
    [summary],
  );

  const activeFilterCount = useMemo(
    () =>
      (["dateFrom", "dateTo", "currency", "status", "orderId", "paymentId", "q"] as const)
        .filter((key) => appliedFilters[key] !== undefined && appliedFilters[key] !== "").length,
    [appliedFilters],
  );

  const warningBadges = summary?.warnings ?? [];
  const showEmptyState = !isSummaryLoading && !summaryError && !hasSummaryContent(summary);
  const tableRows = tableResponse?.rows ?? [];
  const pageStart = tableResponse && tableResponse.totalRows > 0
    ? (tableResponse.page - 1) * tableResponse.pageSize + 1
    : 0;
  const pageEnd = tableResponse && tableResponse.totalRows > 0
    ? Math.min(tableResponse.page * tableResponse.pageSize, tableResponse.totalRows)
    : 0;

  const handleFilterChange = (key: keyof FilterDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleApplyFilters = () => {
    setSearchParams(buildSearchParams(draft, activeTab, { ...tableState, page: 1 }));
  };

  const handleResetFilters = () => {
    const nextDraft: FilterDraft = {
      dateFrom: "",
      dateTo: "",
      currency: "",
      status: "",
      orderId: "",
      paymentId: "",
      q: "",
      compare: "none",
    };

    setDraft(nextDraft);
    setSearchParams(buildSearchParams(nextDraft, activeTab, { ...tableState, page: 1 }));
  };

  const handleTabChange = (tabId: string) => {
    const nextTab = tabId === "table" ? "table" : "overview";
    setActiveTab(nextTab);
    setSearchParams(buildSearchParams(draft, nextTab, { ...tableState, page: 1 }));
  };

  const handleTableStateChange = (nextState: Partial<TableState>) => {
    setSearchParams(
      buildSearchParams(draft, "table", {
        ...tableState,
        ...nextState,
      }),
    );
  };

  const handleSortChange = (sortBy: PaymentsTableSortBy) => {
    const nextSortDir: ReportSortDirection =
      tableState.sortBy === sortBy && tableState.sortDir === "desc" ? "asc" : "desc";

    handleTableStateChange({
      page: 1,
      sortBy,
      sortDir: nextSortDir,
    });
  };

  return (
    <ReportPageLayout
      eyebrow="Reports"
      title="Checkout / Payments"
      description="Payment-level gross, fee, refund, exchange-rate, and net payout reporting from the payments summary endpoint."
      filters={(
        <ReportFiltersBar
          activeCount={activeFilterCount}
          actions={(
            <>
              <Button variant="secondary" size="sm" onClick={handleResetFilters}>
                Reset
              </Button>
              <Button variant="primary" size="sm" onClick={handleApplyFilters}>
                Apply filters
              </Button>
            </>
          )}
        >
          <label className="field" data-span="2">
            <span className="field__label">Date from</span>
            <input
              className="field__control"
              type="date"
              value={draft.dateFrom}
              onChange={(event) => handleFilterChange("dateFrom", event.target.value)}
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Date to</span>
            <input
              className="field__control"
              type="date"
              value={draft.dateTo}
              onChange={(event) => handleFilterChange("dateTo", event.target.value)}
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Currency</span>
            <input
              className="field__control"
              type="text"
              value={draft.currency}
              onChange={(event) => handleFilterChange("currency", event.target.value)}
              placeholder="TRY"
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Status</span>
            <input
              className="field__control"
              type="text"
              value={draft.status}
              onChange={(event) => handleFilterChange("status", event.target.value)}
              placeholder="Completed"
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Order ID</span>
            <input
              className="field__control"
              type="text"
              value={draft.orderId}
              onChange={(event) => handleFilterChange("orderId", event.target.value)}
              placeholder="1234567890"
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Payment ID</span>
            <input
              className="field__control"
              type="text"
              value={draft.paymentId}
              onChange={(event) => handleFilterChange("paymentId", event.target.value)}
              placeholder="987654321"
            />
          </label>
          <label className="field" data-span="6">
            <span className="field__label">Search</span>
            <input
              className="field__control"
              type="text"
              value={draft.q}
              onChange={(event) => handleFilterChange("q", event.target.value)}
              placeholder="payment id, order id, status"
            />
          </label>
          <label className="field" data-span="3">
            <span className="field__label">Compare</span>
            <select
              className="field__control"
              value={draft.compare}
              onChange={(event) =>
                handleFilterChange("compare", event.target.value as ReportComparisonMode)
              }
            >
              {COMPARE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </ReportFiltersBar>
      )}
      tabs={(
        <ReportTabs tabs={REPORT_TABS} activeTabId={activeTab} onTabChange={handleTabChange} />
      )}
    >
      {isSummaryLoading ? (
        <LoadingState
          title="Loading payments summary"
          description="Fetching KPI, insight, warning, and chart summary data."
        />
      ) : null}

      {!isSummaryLoading && summaryError ? (
        <p className="status-card status-card--error">{summaryError}</p>
      ) : null}

      {!isSummaryLoading && !summaryError && activeTab === "overview" ? (
        <>
          {warningBadges.length > 0 ? (
            <section className="report-warning-list">
              {warningBadges.map((warning) => (
                <p key={warning} className="status-card report-warning-card">
                  <Badge variant="warning" size="sm">
                    Warning
                  </Badge>
                  {warning}
                </p>
              ))}
            </section>
          ) : null}

          {showEmptyState ? (
            <EmptyState
              eyebrow="No report data"
              title="No payments match the current filters"
              description="Adjust the filters or clear them to load KPI, chart, and insight data."
            />
          ) : (
            <>
              {summary?.provenance?.payments ? (
                <FinancialProvenanceStrip payments={summary.provenance.payments} />
              ) : null}
              {summary && summary.kpis.length > 0 ? (
                <KpiCardGrid columns={4}>
                  {summary.kpis.map((kpi) => (
                    <KpiCard key={kpi.key} kpi={kpi} />
                  ))}
                </KpiCardGrid>
              ) : (
                <p className="status-card">No KPI cards are available for the current filters.</p>
              )}

              {summary && summary.insights.length > 0 ? (
                <InsightBlockList insights={summary.insights} />
              ) : (
                <p className="status-card">No insights were returned for the current filters.</p>
              )}

              <section className="report-chart-grid">
                {chartSections.map((section) => (
                  <ReportChartCard
                    key={section.key}
                    title={section.title}
                    subtitle={section.subtitle}
                  >
                    <SimpleChartTable rows={section.rows} emptyMessage={section.emptyMessage} />
                  </ReportChartCard>
                ))}
              </section>

              <Collapsible title="Raw monthly data">
                {rawDataSections.map((section) => (
                  <ReportChartCard
                    key={section.key}
                    title={section.title}
                    subtitle={section.subtitle}
                  >
                    <SimpleChartTable rows={section.rows} emptyMessage={section.emptyMessage} />
                  </ReportChartCard>
                ))}
              </Collapsible>
            </>
          )}
        </>
      ) : null}

      {!isSummaryLoading && !summaryError && activeTab === "table" ? (
        <ReportTableShell
          title="Payments Table"
          subtitle="Row-level payment data from the server-side payments table endpoint."
          actions={(
            <div className="report-table-toolbar">
              <label className="field report-table-toolbar__field">
                <span className="field__label">Rows</span>
                <select
                  className="field__control"
                  value={tableState.pageSize}
                  onChange={(event) =>
                    handleTableStateChange({
                      page: 1,
                      pageSize: Number.parseInt(event.target.value, 10),
                    })
                  }
                >
                  {TABLE_PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="report-table-pagination">
                <span className="report-table-pagination__summary">
                  {tableResponse
                    ? `Showing ${pageStart}-${pageEnd} of ${tableResponse.totalRows}`
                    : "No rows loaded"}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!tableResponse || tableResponse.page <= 1 || isTableLoading}
                  onClick={() => handleTableStateChange({ page: Math.max(1, tableState.page - 1) })}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    !tableResponse
                    || tableResponse.totalPages === 0
                    || tableResponse.page >= tableResponse.totalPages
                    || isTableLoading
                  }
                  onClick={() => handleTableStateChange({ page: tableState.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        >
          {isTableLoading ? (
            <p className="status-card">Loading payment rows...</p>
          ) : null}

          {!isTableLoading && tableError ? (
            <p className="status-card status-card--error">{tableError}</p>
          ) : null}

          {!isTableLoading && !tableError && tableResponse && tableRows.length === 0 ? (
            <p className="status-card">No payment rows match the current filters.</p>
          ) : null}

          {!isTableLoading && !tableError && tableRows.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="data-table report-data-table">
                  <thead>
                    <tr>
                      {SORTABLE_TABLE_COLUMNS.map((column) => {
                        const isActive = tableState.sortBy === column.key;
                        const sortLabel = isActive
                          ? tableState.sortDir === "desc"
                            ? "Descending"
                            : "Ascending"
                          : "Not sorted";
                        const columnClassName =
                          column.key === "paymentId" || column.key === "orderId" || column.key === "orderDate"
                            ? "report-data-table__id-width-col"
                            : undefined;

                        return (
                          <th key={column.key} className={columnClassName}>
                            <button
                              type="button"
                              className={isActive ? "report-sort-button report-sort-button--active" : "report-sort-button"}
                              onClick={() => handleSortChange(column.key)}
                            >
                              <span>{column.label}</span>
                              <span className="report-sort-button__meta">
                                {isActive ? (tableState.sortDir === "desc" ? "↓" : "↑") : "↕"}
                                <span className="sr-only">{sortLabel}</span>
                              </span>
                            </button>
                          </th>
                        );
                      })}
                      <th>Exchange Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={`${row.paymentId ?? "payment"}-${row.orderId ?? "order"}-${row.orderDate ?? "date"}`}>
                        <td className="report-data-table__id-width-col">{formatText(row.paymentId)}</td>
                        <td className="report-data-table__id-width-col">{formatText(row.orderId)}</td>
                        <td className="report-data-table__id-width-col">{formatDate(row.orderDate)}</td>
                        <td>{formatMoney(row.grossAmount, row.paymentCurrency)}</td>
                        <td>{formatMoney(row.fees, row.paymentCurrency)}</td>
                        <td>{formatMoney(row.netAmount, row.paymentCurrency)}</td>
                        <td>{formatText(row.paymentCurrency)}</td>
                        <td>{formatText(row.listingCurrency)}</td>
                        <td>{formatMoney(row.refundAmount, row.paymentCurrency)}</td>
                        <td className="report-data-table__listing-cell">
                          <span className="report-data-table__listing-title" title={row.paymentStatus ?? undefined}>
                            {formatText(row.paymentStatus)}
                          </span>
                        </td>
                        <td>{formatRate(row.exchangeRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="report-table-footer">
                <p className="report-table-footer__summary">
                  Page {tableResponse!.page} of {Math.max(tableResponse!.totalPages, 1)}
                </p>
                <div className="report-table-pagination">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={tableResponse!.page <= 1 || isTableLoading}
                    onClick={() => handleTableStateChange({ page: Math.max(1, tableState.page - 1) })}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={tableResponse!.totalPages === 0 || tableResponse!.page >= tableResponse!.totalPages || isTableLoading}
                    onClick={() => handleTableStateChange({ page: tableState.page + 1 })}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </ReportTableShell>
      ) : null}
    </ReportPageLayout>
  );
}

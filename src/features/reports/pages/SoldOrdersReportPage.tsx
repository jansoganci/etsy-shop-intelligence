import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Collapsible, EmptyState, LoadingState } from "../../../components/ui";
import { getOrdersSummary, getOrdersTable } from "../../../data/api/reports.api";
import type {
  OrdersTableRow,
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
  CouponCodeChips,
  SimpleChartTable,
  asChartRows,
} from "../components";

type ReportTabId = "overview" | "table";

type FilterDraft = {
  dateFrom: string;
  dateTo: string;
  country: string;
  city: string;
  currency: string;
  couponUsed: string;
  couponCode: string;
  orderId: string;
  q: string;
  compare: ReportComparisonMode;
};

type OrdersTableSortBy =
  | "orderId"
  | "saleDate"
  | "country"
  | "city"
  | "orderTotal"
  | "orderStatus"
  | "orderCurrency"
  | "couponCode"
  | "revenueAfterDiscount"
  | "netUsdRevenue"
  | "profitMargin";

type TableState = {
  page: number;
  pageSize: number;
  sortBy: OrdersTableSortBy;
  sortDir: ReportSortDirection;
};

const REPORT_TABS: Array<{ id: ReportTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "table", label: "Table" },
];

const DEFAULT_TABLE_STATE: TableState = {
  page: 1,
  pageSize: 25,
  sortBy: "saleDate",
  sortDir: "desc",
};

const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const SORTABLE_TABLE_COLUMNS: Array<{
  key: OrdersTableSortBy;
  label: string;
}> = [
  { key: "orderId", label: "Order ID" },
  { key: "saleDate", label: "Sale Date" },
  { key: "orderTotal", label: "List Value" },
  { key: "revenueAfterDiscount", label: "Gross Sales (USD)" },
  { key: "netUsdRevenue", label: "Net Revenue (USD)" },
  { key: "profitMargin", label: "Profit Margin" },
  { key: "orderCurrency", label: "Currency" },
  { key: "country", label: "Country" },
  { key: "city", label: "City" },
  { key: "couponCode", label: "Coupon Code" },
  { key: "orderStatus", label: "Status" },
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
    country: searchParams.get("country") ?? "",
    city: searchParams.get("city") ?? "",
    currency: searchParams.get("currency") ?? "",
    couponUsed: searchParams.get("couponUsed") ?? "",
    couponCode: searchParams.get("couponCode") ?? "",
    orderId: searchParams.get("orderId") ?? "",
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
    country: draft.country || undefined,
    city: draft.city || undefined,
    currency: draft.currency || undefined,
    couponUsed:
      draft.couponUsed === "true" ? true : draft.couponUsed === "false" ? false : undefined,
    couponCode: draft.couponCode || undefined,
    orderId: draft.orderId || undefined,
    q: draft.q || undefined,
    compare: draft.compare,
  };
}

function clampPositiveInteger(value: string | null, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isSortBy(value: string | null): value is OrdersTableSortBy {
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
    country: filters.country,
    city: filters.city,
    currency: filters.currency,
    couponUsed: filters.couponUsed,
    couponCode: filters.couponCode,
    orderId: filters.orderId,
    q: filters.q,
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

function formatNumber(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US").format(value)
    : "—";
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

function formatUsd(amount: number | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return "\u2014";
  }
  return `USD ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function formatPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "\u2014";
  }
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value * 100)}%`;
}

export function SoldOrdersReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ReportTabId>(() => readActiveTab(searchParams));
  const [draft, setDraft] = useState<FilterDraft>(() => getInitialDraft(searchParams));
  const [summary, setSummary] = useState<ReportSummaryResponse | null>(null);
  const [tableResponse, setTableResponse] = useState<ReportTableResponse<OrdersTableRow> | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isTableLoading, setIsTableLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const searchKey = searchParams.toString();
  const appliedDraft = useMemo(() => getInitialDraft(searchParams), [searchKey]);
  const appliedFilters = useMemo(() => getFiltersFromDraft(appliedDraft), [appliedDraft]);
  const activeFilterCount = useMemo(
    () =>
      (["dateFrom", "dateTo", "country", "city", "currency", "couponUsed", "couponCode", "orderId", "q"] as const)
        .filter((key) => appliedFilters[key] !== undefined && appliedFilters[key] !== "").length,
    [appliedFilters],
  );
  const tableState = useMemo(() => getTableState(searchParams), [searchKey]);

  useEffect(() => {
    setDraft(getInitialDraft(searchParams));
    setActiveTab(readActiveTab(searchParams));
  }, [searchParams]);

  useEffect(() => {
    let isCancelled = false;

    setIsSummaryLoading(true);
    setSummaryError(null);

    void getOrdersSummary(appliedFilters)
      .then((result) => {
        if (!isCancelled) {
          setSummary(result);
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setSummaryError(
            fetchError instanceof Error ? fetchError.message : "Failed to load sold orders summary.",
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

    void getOrdersTable(buildTableRequest(appliedFilters, tableState))
      .then((result) => {
        if (!isCancelled) {
          setTableResponse(result);
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setTableError(
            fetchError instanceof Error ? fetchError.message : "Failed to load sold orders table.",
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
        key: "monthlyOrdersRevenue",
        title: "Monthly Orders Revenue",
        subtitle: "Month-by-month order count, revenue, and average order value from the orders summary endpoint.",
        rows: asChartRows(summary?.charts?.monthlyOrdersRevenue),
        emptyMessage: "No monthly order revenue trend data is available for the current filters.",
      },
    ],
    [summary],
  );

  const chartSections = useMemo(
    () => [
      {
        key: "topCountries",
        title: "Top Countries",
        subtitle: "Country-level order counts and order value from sold orders.",
        rows: asChartRows(summary?.charts?.topCountries),
        emptyMessage: "No country ranking data is available for the current filters.",
      },
      {
        key: "topCities",
        title: "Top Cities",
        subtitle: "City-level order counts and order value from sold orders.",
        rows: asChartRows(summary?.charts?.topCities),
        emptyMessage: "No city ranking data is available for the current filters.",
      },
      {
        key: "couponVsNoCoupon",
        title: "Coupon vs No Coupon",
        subtitle: "Comparison of coupon-backed and non-coupon order segments.",
        rows: asChartRows(summary?.charts?.couponVsNoCoupon),
        emptyMessage: "No coupon segment data is available for the current filters.",
      },
      {
        key: "itemsPerOrderDistribution",
        title: "Items per Order Distribution",
        subtitle: "Order-count distribution grouped by basket-size buckets.",
        rows: asChartRows(summary?.charts?.itemsPerOrderDistribution),
        emptyMessage: "No item distribution data is available for the current filters.",
      },
      {
        key: "currencySplit",
        title: "Currency Split",
        subtitle: "Order volume and value by order currency.",
        rows: asChartRows(summary?.charts?.currencySplit),
        emptyMessage: "No currency split data is available for the current filters.",
      },
      {
        key: "couponEffectiveness",
        title: "Coupon Effectiveness",
        subtitle: "Coupon-level order counts, value, AOV, and discount rate.",
        rows: asChartRows(summary?.charts?.couponEffectiveness),
        emptyMessage: "No coupon effectiveness data is available for the current filters.",
      },
    ],
    [summary],
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
    setSearchParams(buildSearchParams(draft, activeTab, {
      ...tableState,
      page: 1,
    }));
  };

  const handleResetFilters = () => {
    const nextDraft: FilterDraft = {
      dateFrom: "",
      dateTo: "",
      country: "",
      city: "",
      currency: "",
      couponUsed: "",
      couponCode: "",
      orderId: "",
      q: "",
      compare: "none",
    };

    setDraft(nextDraft);
    setSearchParams(buildSearchParams(nextDraft, activeTab, {
      ...tableState,
      page: 1,
    }));
  };

  const handleTabChange = (tabId: string) => {
    const nextTab = tabId === "table" ? "table" : "overview";
    setActiveTab(nextTab);
    setSearchParams(
      buildSearchParams(draft, nextTab, {
        ...tableState,
        page: 1,
      }),
    );
  };

  const handleTableStateChange = (nextState: Partial<TableState>) => {
    setSearchParams(
      buildSearchParams(draft, "table", {
        ...tableState,
        ...nextState,
      }),
    );
  };

  const handleSortChange = (sortBy: OrdersTableSortBy) => {
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
      title="Sold Orders"
      description="Order-level revenue, basket, market, and coupon performance from the sold orders summary endpoint."
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
            <span className="field__label">Country</span>
            <input
              className="field__control"
              type="text"
              value={draft.country}
              onChange={(event) => handleFilterChange("country", event.target.value)}
              placeholder="US"
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">City</span>
            <input
              className="field__control"
              type="text"
              value={draft.city}
              onChange={(event) => handleFilterChange("city", event.target.value)}
              placeholder="New York"
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Currency</span>
            <input
              className="field__control"
              type="text"
              value={draft.currency}
              onChange={(event) => handleFilterChange("currency", event.target.value)}
              placeholder="USD"
            />
          </label>
          <label className="field" data-span="2">
            <span className="field__label">Coupon used</span>
            <select
              className="field__control"
              value={draft.couponUsed}
              onChange={(event) => handleFilterChange("couponUsed", event.target.value)}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className="field" data-span="3">
            <span className="field__label">Coupon code</span>
            <input
              className="field__control"
              type="text"
              value={draft.couponCode}
              onChange={(event) => handleFilterChange("couponCode", event.target.value)}
              placeholder="SPRING20"
            />
          </label>
          <label className="field" data-span="3">
            <span className="field__label">Order ID</span>
            <input
              className="field__control"
              type="text"
              value={draft.orderId}
              onChange={(event) => handleFilterChange("orderId", event.target.value)}
              placeholder="1234567890"
            />
          </label>
          <label className="field" data-span="3">
            <span className="field__label">Search</span>
            <input
              className="field__control"
              type="text"
              value={draft.q}
              onChange={(event) => handleFilterChange("q", event.target.value)}
              placeholder="order id, coupon code, country"
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
          title="Loading sold orders summary"
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
              title="No sold orders match the current filters"
              description="Adjust the filters or clear them to load KPI, chart, and insight data."
            />
          ) : (
            <>
              {summary?.provenance ? (
                <FinancialProvenanceStrip
                  orders={summary.provenance.orders}
                  payments={summary.provenance.payments}
                />
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
          title="Sold Orders Table"
          subtitle="Row-level sold order data from the server-side orders table endpoint."
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
            <p className="status-card">Loading sold order rows...</p>
          ) : null}

          {!isTableLoading && tableError ? (
            <p className="status-card status-card--error">{tableError}</p>
          ) : null}

          {!isTableLoading && !tableError && tableResponse && tableRows.length === 0 ? (
            <p className="status-card">
              No sold order rows match the current filters.
            </p>
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
                          column.key === "orderId" || column.key === "saleDate"
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
                      <th>Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={`${row.orderId ?? "order"}-${row.saleDate ?? "date"}-${row.orderStatus ?? "status"}`}>
                        <td className="report-data-table__id-width-col">{formatText(row.orderId)}</td>
                        <td className="report-data-table__id-width-col">{formatDate(row.saleDate)}</td>
                        <td>{formatMoney(row.orderValue, row.orderCurrency)}</td>
                        <td>{formatMoney(row.revenueAfterDiscount, row.orderCurrency)}</td>
                        <td>{formatUsd(row.netUsdRevenue)}</td>
                        <td>{formatPercent(row.profitMargin)}</td>
                        <td>{formatText(row.orderCurrency)}</td>
                        <td>{formatText(row.shipCountry)}</td>
                        <td>{formatText(row.shipCity)}</td>
                        <td className="report-data-table__coupon-cell">
                          <CouponCodeChips
                            couponCode={row.couponCode}
                            couponDetails={row.couponDetails}
                          />
                        </td>
                        <td className="report-data-table__listing-cell">
                          <span className="report-data-table__listing-title" title={row.orderStatus ?? undefined}>
                            {formatText(row.orderStatus)}
                          </span>
                        </td>
                        <td>{formatNumber(row.numberOfItems)}</td>
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

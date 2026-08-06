import { useEffect, useMemo, useState } from "react";
import "../combined-analytics.css";
import { HeaderBar } from "../../dashboard/components/HeaderBar";
import { KpiCard } from "../../dashboard/components/KpiCard";
import { ChartPanel } from "../../dashboard/components/ChartPanel";
import {
  Badge,
  Button,
  DashboardCard,
  DataTable,
  EmptyState,
  LoadingState,
  PageSection,
  Select,
  StatGrid,
} from "../../../components/ui";
import { fetchCombinedAnalytics } from "../../../data/api/combinedAnalytics.api";
import type {
  CombinedAnalyticsResponse,
  CombinedAnalyticsRow,
  QuadrantLabel,
} from "../../../data/types/combinedAnalytics";
import { combinedAnalyticsChart } from "../charts/combinedAnalyticsChart";

const QUADRANT_LABELS: Record<QuadrantLabel, string> = {
  high_traffic_high_sales: "High traffic / high sales",
  high_traffic_low_sales: "High traffic / low sales",
  low_traffic_high_sales: "Low traffic / high sales",
  low_traffic_low_sales: "Low traffic / low sales",
};

const numberFormatter = new Intl.NumberFormat("en-US");

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

type SortKey = "listingTitle" | "pageViews" | "sessions" | "orderCount" | "unitsSold" | "quadrant";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "pageViews", label: "Page Views" },
  { value: "sessions", label: "Sessions" },
  { value: "orderCount", label: "Orders" },
  { value: "unitsSold", label: "Units" },
  { value: "listingTitle", label: "Listing" },
  { value: "quadrant", label: "Quadrant" },
];

function sortRows(rows: CombinedAnalyticsRow[], key: SortKey, dir: SortDir): CombinedAnalyticsRow[] {
  const sorted = [...rows].sort((a, b) => {
    const left = key === "listingTitle" || key === "quadrant" ? (a[key] ?? "") : a[key];
    const right = key === "listingTitle" || key === "quadrant" ? (b[key] ?? "") : b[key];
    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right));
    }
    return (left as number) - (right as number);
  });
  return dir === "asc" ? sorted : sorted.reverse();
}

export function CombinedAnalyticsPage() {
  const [data, setData] = useState<CombinedAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pageViews");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchCombinedAnalytics()
      .then((response) => {
        if (!cancelled) {
          setData(response);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Combined analytics could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedRows = useMemo(() => {
    if (!data?.available) {
      return [];
    }
    return sortRows(data.rows, sortKey, sortDir);
  }, [data, sortKey, sortDir]);

  return (
    <>
      <HeaderBar
        eyebrow="Combined Intelligence"
        title="Combined Analytics"
        subtitle="See how your Etsy sales and website traffic relate to each other."
      />

      <PageSection gap="sm">
        <p className="status-card">
          This is a proxy signal, not attribution — it does not prove that traffic caused (or failed to
          cause) sales. Treat it as a direction to investigate, not a conclusion.
        </p>
      </PageSection>

      {isLoading ? (
        <LoadingState
          title="Loading combined analytics"
          description="Matching Google Analytics traffic to Etsy listings from /api/combined-analytics."
        />
      ) : error ? (
        <DashboardCard className="page-placeholder">
          <Badge variant="error" size="sm">
            Connection error
          </Badge>
          <h2>Combined analytics is unavailable</h2>
          <p className="status-card status-card--error">{error}</p>
        </DashboardCard>
      ) : !data?.available ? (
        <EmptyState
          eyebrow="No data yet"
          title={
            data?.reason === "no_ga_top_pages"
              ? "Google Analytics traffic hasn't been synced yet"
              : "The synced date range could not be determined"
          }
          description={
            data?.reason === "no_ga_top_pages" ? (
              <>
                Go to the <strong>Google Analytics</strong> page and click{" "}
                <strong>Sync Google Analytics</strong> first, then come back here.
              </>
            ) : (
              <>Try re-running the Google Analytics sync, then reload this page.</>
            )
          }
        />
      ) : (
        <PageSection gap="md">
          <DashboardCard variant="compact">
            <Badge variant={data.guardrails.meetsMinimumData ? "neutral" : "warning"} size="sm">
              {data.guardrails.meetsMinimumData ? "Guardrails passed" : "Not enough matched data"}
            </Badge>
            <p className="status-card">
              Common range: {data.guardrails.commonRange?.from} – {data.guardrails.commonRange?.to}.{" "}
              {data.guardrails.matchedListingCount} of {data.guardrails.activeListingCount} active listings
              matched Google Analytics traffic ({formatPercent(data.guardrails.listingMatchRate)}).
            </p>
            {data.guardrails.reasons.length > 0 ? (
              <ul className="status-card">
                {data.guardrails.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </DashboardCard>

          {!data.guardrails.meetsMinimumData ? (
            <DashboardCard>
              <h2>Not enough matched listings yet</h2>
              <p className="status-card">
                Combined Analytics needs at least a few listings with both traffic and sales data before a
                comparison is reliable. Sync more Google Analytics history or check back once more traffic
                data is available.
              </p>
            </DashboardCard>
          ) : (
            <>
              <StatGrid columns={3}>
                <KpiCard
                  label="Matched Listings"
                  value={`${data.guardrails.matchedListingCount}/${data.guardrails.activeListingCount}`}
                  footerLabel="Listing match rate"
                  footerValue={formatPercent(data.guardrails.listingMatchRate)}
                  tone="accent"
                />
                <KpiCard
                  label="Page Match Rate"
                  value={formatPercent(data.guardrails.pageMatchRate)}
                  footerLabel="Matched pages"
                  footerValue={`${data.guardrails.matchedPageRows}/${data.guardrails.totalPageRows}`}
                  tone="neutral"
                />
                <KpiCard
                  label="Common Range"
                  value={`${data.guardrails.commonRange?.from} – ${data.guardrails.commonRange?.to}`}
                  footerLabel="Source"
                  footerValue="Google Analytics sync"
                  tone="neutral"
                />
              </StatGrid>

              <ChartPanel
                title="Traffic vs. sales"
                subtitle="Each dot is one listing. Dashed lines mark the median traffic and median orders."
                option={combinedAnalyticsChart(data.rows, data.quadrantMedians)}
              />

              <div className="combined-analytics-sort">
                <Select
                  label="Sort by"
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as SortKey)}
                  options={SORT_OPTIONS}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSortDir((current) => (current === "asc" ? "desc" : "asc"))}
                >
                  {sortDir === "asc" ? "Ascending ▲" : "Descending ▼"}
                </Button>
              </div>

              <DataTable
                title="Listings"
                subtitle="Traffic and sales for every listing that matched Google Analytics data or had sales in the common range."
                columns={["Listing", "Page Views", "Sessions", "Orders", "Units", "Quadrant"]}
                emptyMessage="No matched listings."
                rows={sortedRows.map((row) => [
                  row.listingTitle ?? row.listingId,
                  numberFormatter.format(row.pageViews),
                  numberFormatter.format(row.sessions),
                  numberFormatter.format(row.orderCount),
                  numberFormatter.format(row.unitsSold),
                  QUADRANT_LABELS[row.quadrant],
                ])}
              />
            </>
          )}
        </PageSection>
      )}
    </>
  );
}

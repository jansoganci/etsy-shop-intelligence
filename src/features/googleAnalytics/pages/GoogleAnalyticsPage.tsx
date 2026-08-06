import { useEffect, useMemo, useState } from "react";
import "../google-analytics.css";
import {
  fetchGoogleAnalyticsSummary,
  syncGoogleAnalytics,
  type GoogleAnalyticsSummaryRange,
  type GoogleAnalyticsSummaryApiResponse,
} from "../../../data/api/analytics.api";
import { formatDateTime } from "../../../utils/dates";
import { ChartPanel } from "../../dashboard/components/ChartPanel";
import { HeaderBar } from "../../dashboard/components/HeaderBar";
import { KpiCard } from "../../dashboard/components/KpiCard";
import { trafficTrendChart } from "../charts/trafficTrendChart";
import {
  Badge,
  Button,
  DashboardCard,
  DataTable,
  EmptyState,
  LoadingState,
  PageSection,
  StatGrid,
} from "../../../components/ui";

type AnalyticsSummary = GoogleAnalyticsSummaryApiResponse;

const RANGE_OPTIONS: Array<{
  value: GoogleAnalyticsSummaryRange;
  label: string;
}> = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 180 days" },
  { value: "365d", label: "Last 365 days" },
];

function hasAnalyticsData(summary: AnalyticsSummary | null): boolean {
  if (!summary) {
    return false;
  }

  return (
    summary.lastSync !== null ||
    summary.dailyTrend.length > 0 ||
    summary.trafficSources.length > 0 ||
    summary.topPages.length > 0 ||
    summary.countries.length > 0 ||
    summary.devices.length > 0 ||
    summary.events.length > 0 ||
    summary.kpis.activeUsers > 0 ||
    summary.kpis.sessions > 0 ||
    summary.kpis.screenPageViews > 0 ||
    summary.kpis.eventCount > 0
  );
}

function formatSyncDate(value: string | null | undefined): string {
  if (!value) {
    return "Not synced yet";
  }

  return formatDateTime(value);
}

export function GoogleAnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [selectedRange, setSelectedRange] = useState<GoogleAnalyticsSummaryRange>("90d");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadSummary(range: GoogleAnalyticsSummaryRange = selectedRange) {
    const result = await fetchGoogleAnalyticsSummary(range);
    setSummary(result);
  }

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const result = await fetchGoogleAnalyticsSummary(selectedRange);

        if (!isMounted) {
          return;
        }

        setSummary(result);
      } catch (loadError) {
        if (!isMounted) {
          return;
        }

        setSummary(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load Google Analytics summary.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [selectedRange]);

  const formatter = new Intl.NumberFormat("en-US");
  const chartOption = useMemo(
    () => trafficTrendChart(summary?.dailyTrend ?? []),
    [summary?.dailyTrend],
  );
  const hasData = hasAnalyticsData(summary);

  async function handleSync() {
    try {
      setIsSyncing(true);
      setSyncError(null);
      setError(null);
      await syncGoogleAnalytics();
      await loadSummary();
    } catch (syncLoadError) {
      setSyncError(
        syncLoadError instanceof Error
          ? syncLoadError.message
          : "Failed to sync Google Analytics.",
      );
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <>
      <HeaderBar
        eyebrow="Google Analytics"
        title="Traffic & Listing Discovery"
        subtitle="D1-backed Etsy traffic reporting with manual sync and a first pass at listing discovery signals."
      />

      <PageSection gap="sm">
        <DashboardCard variant="compact" className="analytics-sync-panel">
          <div className="analytics-sync-bar">
            <span className="analytics-sync-bar__title">Google Analytics sync</span>

            <span className="analytics-sync-bar__item">
              Last sync{" "}
              <strong>{formatSyncDate(summary?.lastSync?.syncedAt)}</strong>
            </span>

            <label className="analytics-sync-bar__item analytics-sync-bar__range">
              <span>Range</span>
              <select
                className="field__control analytics-range-select"
                value={selectedRange}
                onChange={(event) => setSelectedRange(event.target.value as GoogleAnalyticsSummaryRange)}
                disabled={isLoading || isSyncing}
              >
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="analytics-sync-bar__actions">
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => void handleSync()}
                disabled={isSyncing}
              >
                {isSyncing ? "Syncing..." : "Sync Google Analytics"}
              </Button>
            </div>
          </div>
        </DashboardCard>

        {syncError ? (
          <p className="status-card status-card--error">
            <Badge variant="error" size="sm">
              Sync error
            </Badge>
            {syncError}
          </p>
        ) : null}
      </PageSection>

      {isLoading ? (
        <LoadingState
          title="Loading Google Analytics summary"
          description="Fetching the D1-backed Google Analytics summary from `/api/analytics/summary` for the selected range."
        />
      ) : error ? (
        <DashboardCard className="page-placeholder">
          <Badge variant="error" size="sm">
            Connection error
          </Badge>
          <h2>Google Analytics summary is unavailable</h2>
          <p className="status-card status-card--error">{error}</p>
        </DashboardCard>
      ) : !hasData ? (
        <EmptyState
          eyebrow="No synced analytics"
          title="Google Analytics data has not been loaded into D1 yet"
          description={
            <>
              Click <strong>Sync Google Analytics</strong> to run the first daily sync. Additional
              sections will fill in once broader report syncs are available.
            </>
          }
        />
      ) : (
        <PageSection className={isSyncing ? "analytics-content--syncing" : undefined}>
          <StatGrid columns={4}>
            <KpiCard
              label="Active Users"
              value={formatter.format(summary?.kpis.activeUsers ?? 0)}
              footerLabel="Sync window"
              footerValue={summary?.lastSync?.dateTo ?? "D1 summary"}
              tone="positive"
            />
            <KpiCard
              label="Sessions"
              value={formatter.format(summary?.kpis.sessions ?? 0)}
              footerLabel="Source"
              footerValue="ga_daily_metrics"
              tone="accent"
            />
            <KpiCard
              label="Page Views"
              value={formatter.format(summary?.kpis.screenPageViews ?? 0)}
              footerLabel="Traffic trend"
              footerValue={`${summary?.dailyTrend.length ?? 0} days`}
              tone="neutral"
            />
            <KpiCard
              label="Event Count"
              value={formatter.format(summary?.kpis.eventCount ?? 0)}
              footerLabel="Events tracked"
              footerValue={`${summary?.events.length ?? 0} names`}
              tone="warning"
            />
          </StatGrid>

          <section className="chart-stack">
            <ChartPanel
              title="Daily traffic trend"
              subtitle="Active users, sessions, and page views across the latest synced daily window."
              option={chartOption}
            />
          </section>

          <section className="chart-grid">
            <DataTable
              title="Traffic sources"
              subtitle="Session channel group breakdown from the latest synced range."
              columns={["Channel Group", "Active Users", "Sessions", "Page Views"]}
              rows={(summary?.trafficSources ?? []).map((row) => [
                row.channelGroup,
                formatter.format(row.activeUsers),
                formatter.format(row.sessions),
                formatter.format(row.screenPageViews),
              ])}
              emptyMessage="No traffic source rows are stored for the latest synced range yet."
            />
            <DataTable
              title="Top listings and pages"
              subtitle="Most viewed landing pages tied to the latest synced Google Analytics range."
              columns={["Page Title", "Page Path", "Active Users", "Sessions", "Page Views"]}
              rows={(summary?.topPages ?? []).map((row) => [
                row.pageTitle || "Untitled page",
                <span className="data-table__truncate" title={row.pagePath}>
                  {row.pagePath}
                </span>,
                formatter.format(row.activeUsers),
                formatter.format(row.sessions),
                formatter.format(row.screenPageViews),
              ])}
              emptyMessage="No top page rows are stored for the latest synced range yet."
            />
          </section>

          <section className="chart-grid">
            <DataTable
              title="Countries"
              subtitle="Geographic visitor mix from the current synced range."
              columns={["Country", "Active Users", "Sessions"]}
              rows={(summary?.countries ?? []).map((row) => [
                row.country,
                formatter.format(row.activeUsers),
                formatter.format(row.sessions),
              ])}
              emptyMessage="No country rows are stored for the latest synced range yet."
            />
            <DataTable
              title="Devices"
              subtitle="Device category split from the current synced range."
              columns={["Device", "Active Users", "Sessions"]}
              rows={(summary?.devices ?? []).map((row) => [
                row.deviceCategory,
                formatter.format(row.activeUsers),
                formatter.format(row.sessions),
              ])}
              emptyMessage="No device rows are stored for the latest synced range yet."
            />
          </section>

          <DataTable
            title="Events"
            subtitle="Top event names captured in the synced Google Analytics data."
            columns={["Event Name", "Event Count", "Active Users"]}
            rows={(summary?.events ?? []).map((row) => [
              row.eventName,
              formatter.format(row.eventCount),
              formatter.format(row.activeUsers),
            ])}
            emptyMessage="No event rows are stored for the latest synced range yet."
          />

          <DashboardCard variant="compact" className="analytics-placeholder-panel">
            <Badge variant="neutral" size="sm">
              Coming soon
            </Badge>
            <p className="analytics-placeholder-copy">
              Keyword insights (which searches bring buyers to your listings) need more than Google
              Analytics alone, so this is not available yet.
            </p>
          </DashboardCard>
        </PageSection>
      )}
    </>
  );
}

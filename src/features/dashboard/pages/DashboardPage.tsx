import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboardData } from "../../../app/providers/DashboardDataProvider";
import {
  Badge,
  DashboardCard,
  EmptyState,
  InfoTooltip,
  LoadingState,
  MetricCard,
  PageSection,
  ProvenanceBadge,
  Select,
  StatGrid,
  type DataProvenance,
} from "../../../components/ui";
import { getIntelligenceOverview } from "../../../data/api/intelligence.api";
import type {
  IntelligenceOverviewResponse,
} from "../../../data/types/intelligence";
import { formatCurrency } from "../../../utils/money";
import { salesComparisonChart } from "../charts/salesComparisonChart";
import { ChartPanel } from "../components/ChartPanel";
import { HeaderBar } from "../components/HeaderBar";
import "../dashboard.css";

const STATUS_COPY: Record<
  IntelligenceOverviewResponse["status"],
  { label: string; description: string; badge: "error" | "warning" | "neutral" | "success" }
> = {
  declining: {
    label: "Sales are clearly declining",
    description: "Both the recent period and the year-over-year signal are materially weaker.",
    badge: "error",
  },
  slowing: {
    label: "Sales are slowing",
    description: "The latest period is weaker, but the longer-term signal is not uniformly negative.",
    badge: "warning",
  },
  stable: {
    label: "Sales are within the normal range",
    description: "Recent changes are small enough to treat the current pace as broadly stable.",
    badge: "neutral",
  },
  recovering: {
    label: "Sales are recovering",
    description: "The latest period improved, while the longer-term trend still needs confirmation.",
    badge: "success",
  },
  growing: {
    label: "Sales are growing",
    description: "Both recent and longer-term comparisons support a stronger sales pace.",
    badge: "success",
  },
  insufficient_data: {
    label: "Not enough comparison data",
    description: "The selected period does not have enough historical coverage for a reliable status.",
    badge: "neutral",
  },
};

function formatMonth(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function buildMonthOptions(minDate: string, maxDate: string) {
  const [minYear, minMonth] = minDate.slice(0, 7).split("-").map(Number);
  const [maxYear, maxMonth] = maxDate.slice(0, 7).split("-").map(Number);
  const firstMonth = minYear * 12 + minMonth - 1;
  const lastMonth = maxYear * 12 + maxMonth - 1;

  return Array.from({ length: lastMonth - firstMonth + 1 }, (_, index) => {
    const monthIndex = lastMonth - index;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const paddedMonth = String(month).padStart(2, "0");

    return {
      value: `${year}-${paddedMonth}`,
      label: `${paddedMonth}-${year}`,
    };
  });
}

function formatPeriod(from: string, to: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return `${formatter.format(new Date(`${from}T00:00:00Z`))} – ${formatter.format(
    new Date(`${to}T00:00:00Z`),
  )}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function metricDeltaTone(value: number | null): string {
  if (value === null || value === 0) {
    return "overview-comparison-card__delta--neutral";
  }

  return value > 0
    ? "overview-comparison-card__delta--positive"
    : "overview-comparison-card__delta--negative";
}

function formatUsd(value: number | null): string {
  return value === null ? "Unavailable" : formatCurrency(value, "USD");
}

function ComparisonCard({
  label,
  metric,
  value,
  provenance,
  hint,
  emphasis = false,
}: {
  label: string;
  metric: {
    previousChange: number | null;
    previousYearChange: number | null;
  };
  value: string;
  provenance?: DataProvenance | null;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <DashboardCard
      className={
        emphasis
          ? "overview-comparison-card overview-comparison-card--emphasis"
          : "overview-comparison-card"
      }
      variant="compact"
    >
      <div className="overview-comparison-card__label-row">
        <span className="overview-comparison-card__label">
          {label}
          {hint ? <InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip> : null}
        </span>
        <ProvenanceBadge provenance={provenance} />
      </div>
      <strong className="overview-comparison-card__value">{value}</strong>
      <div className="overview-comparison-card__comparisons">
        <span className={metricDeltaTone(metric.previousChange)}>
          {formatPercent(metric.previousChange)}
          <small> vs previous</small>
        </span>
        <span className={metricDeltaTone(metric.previousYearChange)}>
          {formatPercent(metric.previousYearChange)}
          <small> vs last year</small>
        </span>
      </div>
    </DashboardCard>
  );
}

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { importCompletionCount } = useDashboardData();
  const [overview, setOverview] = useState<IntelligenceOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedMonth = searchParams.get("month") ?? undefined;

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    void getIntelligenceOverview(selectedMonth)
      .then((result) => {
        if (!isCancelled) {
          setOverview(result);
        }
      })
      .catch((reason: unknown) => {
        if (!isCancelled) {
          setOverview(null);
          setError(reason instanceof Error ? reason.message : "Failed to load shop intelligence.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedMonth, importCompletionCount]);

  const statusCopy = useMemo(
    () => (overview ? STATUS_COPY[overview.status] : STATUS_COPY.insufficient_data),
    [overview],
  );
  const trendOption = useMemo(
    () => (overview ? salesComparisonChart(overview) : null),
    [overview],
  );
  const monthOptions = useMemo(
    () =>
      overview
        ? buildMonthOptions(overview.coverage.minDate, overview.coverage.maxDate)
        : [{ value: "", label: "--" }],
    [overview],
  );

  return (
    <>
      <HeaderBar
        eyebrow="Shop Intelligence"
        title="Overview"
        subtitle="A decision-first view of sales direction, stability, and the listings driving change."
        actions={
          <label className="overview-month-picker">
            <span>Period (MM-YYYY)</span>
            <Select
              value={selectedMonth ?? overview?.selectedMonth ?? ""}
              options={monthOptions}
              disabled={!overview}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams);
                next.set("month", event.target.value);
                setSearchParams(next);
              }}
            />
          </label>
        }
      />

      {isLoading ? (
        <LoadingState
          title="Loading shop intelligence"
          description="Calculating equal-period comparisons and sales stability."
        />
      ) : null}

      {!isLoading && error ? (
        <EmptyState
          eyebrow="Overview unavailable"
          title="Shop intelligence could not be loaded"
          description={error}
        />
      ) : null}

      {!isLoading && !error && overview ? (
        <PageSection gap="md">
          <div className="overview-freshness" role="status">
            <span>
              Data through <strong>{overview.coverage.maxDate}</strong>
            </span>
            <span>
              Viewing <strong>{formatMonth(overview.selectedMonth)}</strong>
            </span>
            <span>
              Compared with <strong>{formatMonth(overview.ranges.previous.month)}</strong> and{" "}
              <strong>{formatMonth(overview.ranges.previousYear.month)}</strong>
            </span>
            <Badge variant={overview.ranges.current.isPartial ? "warning" : "success"} size="sm">
              {overview.ranges.current.isPartial ? "Partial month" : "Complete month"}
            </Badge>
          </div>

          <StatGrid columns={2} className="overview-goal-metrics">
            <MetricCard
              label="Orders goal"
              value={overview.metrics.orders.current.toLocaleString("en-US")}
              tone="accent"
              progress={0.41}
            />
            <MetricCard
              label="Gross sales goal"
              value={formatUsd(overview.metrics.grossSales.current)}
              tone="positive"
              progress={0.72}
            />
          </StatGrid>

          <DashboardCard className={`overview-status-hero overview-status-hero--${overview.status}`}>
            <div className="overview-status-hero__top">
              <div className="overview-status-hero__copy">
                <Badge variant={statusCopy.badge} size="sm">
                  Shop status
                </Badge>
                <h2>{statusCopy.label}</h2>
                <p>{statusCopy.description}</p>
                <span className="overview-status-hero__period">
                  {formatPeriod(overview.ranges.current.from, overview.ranges.current.to)}
                </span>
              </div>
              <div className="overview-status-hero__metric">
                <strong>{overview.metrics.orders.current.toLocaleString("en-US")}</strong>
                <span>orders</span>
                <div>
                  <b className={metricDeltaTone(overview.metrics.orders.previousChange)}>
                    {formatPercent(overview.metrics.orders.previousChange)}
                  </b>
                  <small> vs previous period</small>
                </div>
              </div>
            </div>

            <div className="overview-status-hero__drivers">
              <div className="overview-status-hero__drivers-header">
                <span className="eyebrow">What changed</span>
                <p>Listing-level order movement versus the previous period.</p>
              </div>

              <div className="overview-findings-list">
                {overview.findings.leadingDecline ? (
                  <article className="overview-finding overview-finding--negative">
                    <span>Largest decline</span>
                    <strong title={overview.findings.leadingDecline.title}>
                      {overview.findings.leadingDecline.title}
                    </strong>
                    <p>
                      {overview.findings.leadingDecline.previousOrders} →{" "}
                      {overview.findings.leadingDecline.currentOrders} orders (
                      {overview.findings.leadingDecline.delta})
                    </p>
                    <small>
                      {(overview.findings.leadingDecline.lossContribution * 100).toFixed(0)}% of
                      listing-level lost orders
                    </small>
                  </article>
                ) : (
                  <article className="overview-finding">
                    <span>Largest decline</span>
                    <strong>No listing lost orders</strong>
                  </article>
                )}

                {overview.findings.leadingGrowth ? (
                  <article className="overview-finding overview-finding--positive">
                    <span>Largest gain</span>
                    <strong title={overview.findings.leadingGrowth.title}>
                      {overview.findings.leadingGrowth.title}
                    </strong>
                    <p>
                      {overview.findings.leadingGrowth.previousOrders} →{" "}
                      {overview.findings.leadingGrowth.currentOrders} orders (+
                      {overview.findings.leadingGrowth.delta})
                    </p>
                  </article>
                ) : (
                  <article className="overview-finding">
                    <span>Largest gain</span>
                    <strong>No listing gained orders</strong>
                  </article>
                )}
              </div>

              <div className="overview-findings-summary">
                <span>
                  <strong>{overview.findings.decliningListingCount}</strong> listings declined
                </span>
                <span>
                  <strong>{overview.findings.growingListingCount}</strong> listings grew
                </span>
              </div>
            </div>
          </DashboardCard>

          {overview.warnings.length > 0 ? (
            <div className="overview-warning-list">
              {overview.warnings.map((warning) => (
                <p className="status-card" key={warning}>
                  <Badge variant="warning" size="sm">
                    Check
                  </Badge>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <section className="overview-comparison-grid" aria-label="Period comparison">
            <ComparisonCard
              label="Orders"
              metric={overview.metrics.orders}
              value={overview.metrics.orders.current.toLocaleString("en-US")}
            />
            <ComparisonCard
              label="Gross Sales — USD"
              metric={overview.metrics.grossSales}
              value={formatUsd(overview.metrics.grossSales.current)}
              provenance={overview.provenance.orders}
            />
            <ComparisonCard
              label="Etsy Fees — USD"
              metric={overview.metrics.etsyFees}
              value={formatUsd(overview.metrics.etsyFees.current)}
              provenance={overview.provenance.payments}
            />
            <ComparisonCard
              label="Net Revenue — USD"
              metric={overview.metrics.netRevenue}
              value={formatUsd(overview.metrics.netRevenue.current)}
              provenance={overview.provenance.payments}
              hint={
                <>
                  After the Etsy <b>payment processing fee only</b> — this matches
                  Etsy&apos;s own screen, but it is not profit. Advertising,
                  commission, listing renewals and VAT are still to come. See True
                  Net below.
                </>
              }
            />
          </section>

          <div className="overview-subsection-header">
            <span className="eyebrow">
              Etsy account costs
              <InfoTooltip label="Where do these come from?">
                These come from your Etsy account ledger, not from individual
                orders. Etsy charges advertising daily against your balance, so it
                can never be split per order or per country — which is why these
                figures appear on the dashboard only, and not on the filtered
                reports.
              </InfoTooltip>
            </span>
          </div>

          <section className="overview-comparison-grid overview-costs-grid" aria-label="Etsy account costs">
            <ComparisonCard
              label="Ad Spend — USD"
              metric={overview.metrics.adSpend}
              value={formatUsd(overview.metrics.adSpend.current)}
              hint="Etsy Ads and Offsite Ads, charged daily against your Etsy balance."
            />
            <ComparisonCard
              label="Other Etsy Costs — USD"
              metric={overview.metrics.otherEtsyCosts}
              value={formatUsd(overview.metrics.otherEtsyCosts.current)}
              hint={
                <>
                  Transaction commission, listing renewals, regulatory fee and the
                  VAT Etsy charges on its own services — plus the net effect of any
                  refunds in the period, which is why Net Revenue minus these lines
                  always lands exactly on True Net.
                </>
              }
            />
            <ComparisonCard
              label="True Net — USD"
              metric={overview.metrics.trueNet}
              value={formatUsd(overview.metrics.trueNet.current)}
              emphasis
              hint={
                <>
                  What you actually keep: Net Revenue after advertising and every
                  other Etsy cost. Taken from the account ledger and checked against
                  your running Etsy balance.
                </>
              }
            />
          </section>

          <DashboardCard className="overview-stability-card">
            <div className="overview-section-header">
              <div>
                <span className="eyebrow">
                  Sales stability
                  <InfoTooltip label="What do the colors mean?">
                    Each cell is one calendar day in the selected month, colored by that
                    day&apos;s actual order count (computed from your sales data, not decorative):
                    <br />
                    <span className="info-tooltip__swatch" style={{ background: "var(--color-negative)" }} />
                    <strong>Red</strong> — zero orders that day.
                    <br />
                    <span className="info-tooltip__swatch" style={{ background: "var(--color-accent)" }} />
                    <strong>Cyan</strong> — at least one order, outside the 3–5 target band.
                    <br />
                    <span className="info-tooltip__swatch" style={{ background: "var(--color-positive)" }} />
                    <strong>Green</strong> — within the 3–5 orders/day target band.
                  </InfoTooltip>
                </span>
                <h2>Consistency before growth</h2>
                <p>Target: at least 3 daily orders and sales on 80% of days.</p>
              </div>
              <div className="overview-stability-card__score">
                <strong>{(overview.stability.activeDayRate * 100).toFixed(0)}%</strong>
                <span>days with sales</span>
              </div>
            </div>

            <div className="overview-stability-days" aria-label="Daily order activity">
              {overview.dailyTrend.current.map((point) => (
                <span
                  key={point.date}
                  className={[
                    "overview-stability-day",
                    point.orderCount === 0
                      ? "overview-stability-day--zero"
                      : point.orderCount >= 3 && point.orderCount <= 5
                        ? "overview-stability-day--target"
                        : "overview-stability-day--active",
                  ].join(" ")}
                  title={`${point.date}: ${point.orderCount} orders`}
                >
                  {Number(point.date.slice(-2))}
                </span>
              ))}
            </div>

            <div className="overview-stability-stats">
              <div>
                <span>Daily average</span>
                <strong>{overview.stability.dailyAverage.toFixed(2)}</strong>
              </div>
              <div>
                <span>Zero-sale days</span>
                <strong>{overview.stability.zeroSalesDays}</strong>
              </div>
              <div>
                <span>3–5 order days</span>
                <strong>{overview.stability.targetBandDays}</strong>
              </div>
              <div>
                <span>Longest zero streak</span>
                <strong>{overview.stability.longestZeroSalesStreak} days</strong>
              </div>
            </div>
          </DashboardCard>

          <DashboardCard className="overview-top-listings">
            <div className="overview-section-header">
              <div>
                <span className="eyebrow">Top listings</span>
                <h2>Top 5 by order count</h2>
                <p>Gross Sales is supporting context; ranking is based on distinct orders.</p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Listing</th>
                    <th>Orders</th>
                    <th>Units</th>
                    <th>Gross Sales — USD</th>
                    <th>vs previous</th>
                    <th>vs last year</th>
                    <th>Order share</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.topListings.length > 0 ? (
                    overview.topListings.map((listing) => (
                      <tr key={listing.listingId}>
                        <td title={listing.title}>{listing.title}</td>
                        <td><strong>{listing.orderCount}</strong></td>
                        <td>{listing.unitsSold}</td>
                        <td>{formatUsd(listing.grossSales)}</td>
                        <td className={metricDeltaTone(listing.previousDelta)}>
                          {listing.previousDelta > 0 ? "+" : ""}{listing.previousDelta}
                        </td>
                        <td className={metricDeltaTone(listing.previousYearDelta)}>
                          {listing.previousYearDelta > 0 ? "+" : ""}{listing.previousYearDelta}
                        </td>
                        <td>{(listing.orderShare * 100).toFixed(1)}%</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>No listing sales were recorded in this period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </DashboardCard>

          {trendOption ? (
            <ChartPanel
              title="Daily order trend"
              subtitle="Current month against the same number of days in the previous month and previous year."
              option={trendOption}
            />
          ) : null}
        </PageSection>
      ) : null}
    </>
  );
}

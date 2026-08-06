import type { KpiCard as ReportKpiCardData } from "../../../data/types/reports";
import { Badge, DashboardCard } from "../../../components/ui";

type KpiCardProps = {
  kpi: ReportKpiCardData;
  className?: string;
};

function getDeltaVariant(direction: ReportKpiCardData["direction"]): "success" | "warning" | "neutral" {
  if (direction === "up") {
    return "success";
  }

  if (direction === "down") {
    return "warning";
  }

  return "neutral";
}

function getDeltaLabel(kpi: ReportKpiCardData): string | null {
  if (typeof kpi.deltaPercent !== "number" || !Number.isFinite(kpi.deltaPercent)) {
    return null;
  }

  const sign = kpi.deltaPercent > 0 ? "+" : "";
  return `${sign}${(kpi.deltaPercent * 100).toFixed(1)}%`;
}

function getDisplayValue(kpi: ReportKpiCardData): {
  primary: string;
  secondary: string | null;
  title: string;
} {
  const fallback = kpi.formattedValue || "N/A";
  const compactMatch = fallback.match(/^(.*)\s+\(([^()]+)\)$/);
  const shouldCompact =
    kpi.key === "top_listing"
    || kpi.key === "top_market"
    || fallback.length > 42;

  if (shouldCompact && compactMatch) {
    return {
      primary: compactMatch[1].trim(),
      secondary: compactMatch[2].trim(),
      title: fallback,
    };
  }

  return {
    primary: fallback,
    secondary: null,
    title: fallback,
  };
}

export function KpiCard({ kpi, className }: KpiCardProps) {
  const deltaLabel = getDeltaLabel(kpi);
  const displayValue = getDisplayValue(kpi);
  const classes = ["report-kpi-card", "kpi-card", className ?? ""].filter(Boolean).join(" ");

  return (
    <DashboardCard className={classes}>
      <div className="report-kpi-card__header kpi-card__top">
        <p className="report-kpi-card__label kpi-card__label">{kpi.label}</p>
        {kpi.currency ? <span className="report-kpi-card__currency">{kpi.currency}</span> : null}
      </div>

      <div className="report-kpi-card__body">
        <strong className="report-kpi-card__value kpi-card__value" title={displayValue.title}>
          {displayValue.primary}
        </strong>
        {displayValue.secondary ? (
          <span className="report-kpi-card__secondary" title={displayValue.title}>
            {displayValue.secondary}
          </span>
        ) : null}
      </div>

      {(deltaLabel || kpi.note) ? (
        <div className="report-kpi-card__meta">
          {deltaLabel ? (
            <Badge variant={getDeltaVariant(kpi.direction)} size="sm">
              {deltaLabel}
            </Badge>
          ) : null}
          {kpi.note ? <span className="report-kpi-card__note">{kpi.note}</span> : null}
        </div>
      ) : null}
    </DashboardCard>
  );
}

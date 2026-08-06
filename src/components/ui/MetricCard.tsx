import type { ReactNode } from "react";
import { DashboardCard } from "./DashboardCard";
import "./metric-card.css";

type MetricCardTone = "neutral" | "positive" | "accent" | "warning";

type MetricTrend = {
  label: string;
  value: string;
  direction?: "up" | "down" | "flat";
};

type MetricFooter = {
  label: string;
  value: string;
};

type MetricCardVariant = "metric" | "insight";

type MetricCardProps = {
  label: string;
  value: string;
  icon?: ReactNode;
  helper?: string;
  tone?: MetricCardTone;
  trend?: MetricTrend;
  footer?: MetricFooter;
  variant?: MetricCardVariant;
  className?: string;
  /** Optional progress 0–1. When set, shows an accent progress ring. */
  progress?: number;
};

const PROGRESS_RING_SIZE = 28;
const PROGRESS_RING_STROKE = 2.5;
const PROGRESS_RING_RADIUS = (PROGRESS_RING_SIZE - PROGRESS_RING_STROKE) / 2;
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS;

function clampProgress(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function ProgressRing({ progress }: { progress: number }) {
  const clamped = clampProgress(progress);
  const pct = Math.round(clamped * 100);
  const dashOffset = PROGRESS_RING_CIRCUMFERENCE * (1 - clamped);

  return (
    <span
      className="metric-card__progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progress ${pct}%`}
    >
      <svg
        className="metric-card__progress-svg"
        width={PROGRESS_RING_SIZE}
        height={PROGRESS_RING_SIZE}
        viewBox={`0 0 ${PROGRESS_RING_SIZE} ${PROGRESS_RING_SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="metric-card__progress-track"
          cx={PROGRESS_RING_SIZE / 2}
          cy={PROGRESS_RING_SIZE / 2}
          r={PROGRESS_RING_RADIUS}
        />
        <circle
          className="metric-card__progress-value"
          cx={PROGRESS_RING_SIZE / 2}
          cy={PROGRESS_RING_SIZE / 2}
          r={PROGRESS_RING_RADIUS}
          strokeDasharray={PROGRESS_RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  icon,
  helper,
  tone = "neutral",
  trend,
  footer,
  variant = "metric",
  className,
  progress,
}: MetricCardProps) {
  const trendDirectionClass = trend?.direction ? `metric-card__trend--${trend.direction}` : "";
  const variantClass = variant === "insight" ? "metric-card--insight kpi-card--insight" : "metric-card--metric";
  const showAside = progress != null || icon != null;

  return (
    <DashboardCard
      className={["metric-card", "kpi-card", variantClass, `kpi-card--${tone}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="metric-card__top kpi-card__top">
        <div>
          <p className="metric-card__label kpi-card__label">{label}</p>
          <strong className="metric-card__value kpi-card__value">{value}</strong>
        </div>
        {showAside ? (
          <div className="metric-card__aside">
            {progress != null ? <ProgressRing progress={progress} /> : null}
            {icon ? (
              <span className={`metric-card__icon kpi-card__icon kpi-card__icon--${tone}`} aria-hidden="true">
                {icon}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {trend ? (
        <div className={["metric-card__trend", trendDirectionClass].filter(Boolean).join(" ")}>
          <strong>{trend.value}</strong>
          <span>{trend.label}</span>
        </div>
      ) : null}

      {footer ? (
        <div className="metric-card__footer kpi-card__footer">
          <span>{footer.label}</span>
          <strong>{footer.value}</strong>
        </div>
      ) : null}

      {helper ? <span className="metric-card__helper kpi-card__helper">{helper}</span> : null}
    </DashboardCard>
  );
}

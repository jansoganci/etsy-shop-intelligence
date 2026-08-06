import { AlertTriangle, Info, Lightbulb, TrendingUp } from "lucide-react";
import type { InsightBlock } from "../../../data/types/reports";
import { DashboardCard } from "../../../components/ui";

type InsightBlockCardProps = {
  insight: InsightBlock;
  className?: string;
};

const SEVERITY_ICON: Record<InsightBlock["severity"], typeof Info> = {
  positive: TrendingUp,
  warning: AlertTriangle,
  opportunity: Lightbulb,
  neutral: Info,
};

const SEVERITY_LABEL: Record<InsightBlock["severity"], string> = {
  positive: "Positive",
  warning: "Warning",
  opportunity: "Opportunity",
  neutral: "Note",
};

export function InsightBlockCard({ insight, className }: InsightBlockCardProps) {
  const classes = [
    "report-insight-card",
    `report-insight-card--${insight.severity}`,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const Icon = SEVERITY_ICON[insight.severity];

  return (
    <DashboardCard className={classes}>
      <div className="report-insight-card__header">
        <span className="report-insight-card__icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <div>
          <span className="report-insight-card__severity">{SEVERITY_LABEL[insight.severity]}</span>
          <h3 className="report-insight-card__title">{insight.title}</h3>
        </div>
      </div>
      <p className="report-insight-card__message">{insight.message}</p>
      {insight.action ? <p className="report-insight-card__action">{insight.action}</p> : null}
    </DashboardCard>
  );
}

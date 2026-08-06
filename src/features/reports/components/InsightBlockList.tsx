import type { InsightBlock } from "../../../data/types/reports";
import { InfoTooltip } from "../../../components/ui";
import { InsightBlockCard } from "./InsightBlockCard";

type InsightBlockListProps = {
  insights: InsightBlock[];
  className?: string;
};

export function InsightBlockList({ insights, className }: InsightBlockListProps) {
  const classes = ["report-insight-list", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className="report-insight-section">
      <div className="report-insight-section__header">
        <span className="eyebrow">
          Insights
          <InfoTooltip label="What do these labels mean?">
            <strong>Positive</strong> — a metric moving in a healthy direction.
            <br />
            <strong>Warning</strong> — worth reviewing, not necessarily urgent.
            <br />
            <strong>Opportunity</strong> — a possible action to try.
            <br />
            <strong>Note</strong> — a neutral fact for context.
          </InfoTooltip>
        </span>
      </div>
      <section className={classes}>
        {insights.map((insight) => (
          <InsightBlockCard key={insight.key} insight={insight} />
        ))}
      </section>
    </div>
  );
}

import type { ReactNode } from "react";
import { DashboardCard } from "./DashboardCard";
import { SectionHeader } from "./SectionHeader";

type ChartTab = { id: string; label: string };

type ChartCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  tabs?: ChartTab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
};

export function ChartCard({
  title,
  subtitle,
  children,
  tabs,
  activeTabId,
  onTabChange,
  className,
}: ChartCardProps) {
  const actions =
    tabs && tabs.length > 0 ? (
      <div className="panel-tabs" role="tablist" aria-label={`${title} views`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            className={activeTabId === tab.id ? "panel-tab panel-tab--active" : "panel-tab"}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <DashboardCard className={["chart-card", className ?? ""].filter(Boolean).join(" ")}>
      <SectionHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="chart-card__body">{children}</div>
    </DashboardCard>
  );
}

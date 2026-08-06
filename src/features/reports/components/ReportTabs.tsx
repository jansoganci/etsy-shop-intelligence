type ReportTab = {
  id: string;
  label: string;
};

type ReportTabsProps = {
  tabs: ReportTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  className?: string;
};

export function ReportTabs({
  tabs,
  activeTabId,
  onTabChange,
  className,
}: ReportTabsProps) {
  const classes = ["report-tabs", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={classes} role="tablist" aria-label="Report views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTabId}
          className={tab.id === activeTabId ? "panel-tab panel-tab--active" : "panel-tab"}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

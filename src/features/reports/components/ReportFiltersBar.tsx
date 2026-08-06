import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { DashboardCard } from "../../../components/ui";

type ReportFiltersBarProps = {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  activeCount?: number;
};

export function ReportFiltersBar({
  children,
  actions,
  className,
  activeCount = 0,
}: ReportFiltersBarProps) {
  const [isOpen, setIsOpen] = useState(activeCount > 0);
  const classes = ["report-filters-bar", className ?? ""].filter(Boolean).join(" ");

  return (
    <DashboardCard variant="compact" className={classes}>
      <button
        type="button"
        className="report-filters-bar__trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <span>
          Filters{activeCount > 0 ? <span className="report-filters-bar__count">{activeCount}</span> : null}
        </span>
        <ChevronDown
          size={16}
          className={`collapsible__chevron${isOpen ? " collapsible__chevron--open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <>
          <div className="report-filters-bar__grid">{children}</div>
          {actions ? <div className="report-filters-bar__actions">{actions}</div> : null}
        </>
      ) : null}
    </DashboardCard>
  );
}

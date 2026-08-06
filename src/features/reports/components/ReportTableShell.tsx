import type { ReactNode } from "react";
import { DashboardCard, SectionHeader } from "../../../components/ui";

type ReportTableShellProps = {
  title: string;
  subtitle: string;
  placeholder?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function ReportTableShell({
  title,
  subtitle,
  placeholder = "Report table wiring will use the existing server-side table endpoints in the next step.",
  actions,
  children,
  className,
}: ReportTableShellProps) {
  return (
    <DashboardCard className={["report-table-shell", className ?? ""].filter(Boolean).join(" ")}>
      <SectionHeader title={title} subtitle={subtitle} actions={actions} />
      {children ? (
        <div className="report-table-shell__content">{children}</div>
      ) : (
        <div className="report-table-shell__placeholder">
          <p>{placeholder}</p>
        </div>
      )}
    </DashboardCard>
  );
}

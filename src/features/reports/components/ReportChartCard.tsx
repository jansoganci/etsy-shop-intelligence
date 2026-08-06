import type { ReactNode } from "react";
import { ChartCard } from "../../../components/ui";

type ReportChartCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function ReportChartCard({
  title,
  subtitle,
  children,
  footer,
  className,
}: ReportChartCardProps) {
  return (
    <ChartCard title={title} subtitle={subtitle} className={["report-chart-card", className ?? ""].filter(Boolean).join(" ")}>
      <div className="report-chart-card__content">{children}</div>
      {footer ? <div className="report-chart-card__footer">{footer}</div> : null}
    </ChartCard>
  );
}

import type { PropsWithChildren } from "react";

type KpiCardGridProps = PropsWithChildren<{
  columns?: 2 | 3 | 4;
  className?: string;
}>;

export function KpiCardGrid({ columns = 4, className, children }: KpiCardGridProps) {
  const classes = [
    "report-kpi-grid",
    `report-kpi-grid--${columns}`,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <section className={classes}>{children}</section>;
}

import type { PropsWithChildren } from "react";

type StatGridProps = PropsWithChildren<{
  columns?: 2 | 3 | 4;
  className?: string;
}>;

export function StatGrid({ columns = 4, className, children }: StatGridProps) {
  const classes = [
    "stat-grid",
    "kpi-grid",
    `stat-grid--${columns}`,
    columns === 3 ? "kpi-grid--three" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <section className={classes}>{children}</section>;
}

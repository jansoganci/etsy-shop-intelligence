import type { ElementType, PropsWithChildren } from "react";
import "./dashboard-card.css";

type DashboardCardProps = PropsWithChildren<{
  variant?: "default" | "compact" | "glass";
  className?: string;
  as?: ElementType;
}>;

export function DashboardCard({
  variant = "default",
  className,
  as: Tag = "section",
  children,
}: DashboardCardProps) {
  const classes = [
    "dashboard-card",
    "panel",
    variant === "compact" ? "panel--compact" : "",
    variant === "glass" ? "dashboard-card--glass" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <Tag className={classes}>{children}</Tag>;
}

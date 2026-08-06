import type { ReactNode } from "react";
import { DashboardCard } from "./DashboardCard";

type EmptyStateProps = {
  eyebrow: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ eyebrow, title, description, action, className }: EmptyStateProps) {
  return (
    <DashboardCard className={["empty-state", className ?? ""].filter(Boolean).join(" ")}>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </DashboardCard>
  );
}

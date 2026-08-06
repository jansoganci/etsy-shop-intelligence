import { DashboardCard } from "./DashboardCard";

type LoadingStateProps = {
  title: string;
  description?: string;
  className?: string;
};

export function LoadingState({ title, description, className }: LoadingStateProps) {
  return (
    <DashboardCard className={["loading-state", "page-placeholder", className ?? ""].filter(Boolean).join(" ")}>
      <span className="eyebrow">Loading</span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </DashboardCard>
  );
}

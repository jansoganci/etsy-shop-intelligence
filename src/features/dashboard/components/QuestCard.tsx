import { DashboardCard } from "../../../components/ui/DashboardCard";
import "../quest-card.css";

export type QuestCardProps = {
  title: string;
  description?: string;
  badge?: string;
};

export function QuestCard({ title, description, badge }: QuestCardProps) {
  return (
    <DashboardCard className="quest-card">
      {badge ? <span className="quest-card__badge">{badge}</span> : null}
      <h3 className="quest-card__title">{title}</h3>
      {description ? <p className="quest-card__description">{description}</p> : null}
    </DashboardCard>
  );
}

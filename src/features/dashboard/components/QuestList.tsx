import { QuestCard, type QuestCardProps } from "./QuestCard";

const DEFAULT_QUESTS: QuestCardProps[] = [
  { title: "Focus on your weakest country this week", badge: "Quest" },
  { title: "Review the low-margin coupon", badge: "Quest" },
  { title: "Inspect the high-traffic, low-sales listing", badge: "Quest" },
];

type QuestListProps = {
  quests?: QuestCardProps[];
};

export function QuestList({ quests = DEFAULT_QUESTS }: QuestListProps) {
  const items = quests.slice(0, 3);

  return (
    <section className="quest-list" aria-labelledby="quest-list-heading">
      <div className="dashboard-section-heading">
        <h2 id="quest-list-heading" className="dashboard-section-heading__title">
          This week&apos;s quests
        </h2>
      </div>
      <div className="quest-list__grid">
        {items.map((quest) => (
          <QuestCard key={quest.title} {...quest} />
        ))}
      </div>
    </section>
  );
}

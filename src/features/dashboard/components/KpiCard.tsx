import { MetricCard } from "../../../components/ui";

type KpiCardProps = {
  label: string;
  value: string;
  helper?: string;
  footerLabel: string;
  footerValue: string;
  tone?: "neutral" | "positive" | "accent" | "warning";
  variant?: "metric" | "insight";
};

export function KpiCard({
  label,
  value,
  helper,
  footerLabel,
  footerValue,
  tone = "neutral",
  variant = "metric",
}: KpiCardProps) {
  return (
    <MetricCard
      label={label}
      value={value}
      helper={helper}
      tone={tone}
      variant={variant}
      footer={{
        label: footerLabel,
        value: footerValue,
      }}
    />
  );
}

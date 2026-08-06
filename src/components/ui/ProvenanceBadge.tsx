import { Badge } from "./Badge";

export type DataProvenance = "csv_upload" | "etsy_api" | "etsy_api+csv" | "mixed";

const PROVENANCE_LABELS: Record<DataProvenance, string> = {
  etsy_api: "Etsy API",
  "etsy_api+csv": "Etsy API + CSV",
  csv_upload: "CSV upload",
  mixed: "Mixed sources",
};

const PROVENANCE_VARIANTS: Record<
  DataProvenance,
  "neutral" | "success" | "warning" | "error" | "accent"
> = {
  etsy_api: "accent",
  "etsy_api+csv": "success",
  csv_upload: "neutral",
  mixed: "warning",
};

type ProvenanceBadgeProps = {
  provenance: DataProvenance | null | undefined;
  size?: "sm" | "md";
  className?: string;
};

export function ProvenanceBadge({ provenance, size = "sm", className }: ProvenanceBadgeProps) {
  if (!provenance) {
    return null;
  }

  return (
    <Badge variant={PROVENANCE_VARIANTS[provenance]} size={size} className={className}>
      {PROVENANCE_LABELS[provenance]}
    </Badge>
  );
}

export function provenanceLabel(provenance: DataProvenance | null | undefined): string | null {
  if (!provenance) {
    return null;
  }

  return PROVENANCE_LABELS[provenance];
}

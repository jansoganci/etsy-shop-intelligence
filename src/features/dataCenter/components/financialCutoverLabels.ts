import type {
  EtsyReconciliationStatus,
  FinancialCutoverEntity,
  FinancialMetricStatus,
} from "../../../data/types/dataCenter";

export type BadgeVariant = "neutral" | "success" | "warning" | "error";

/** Mirrors DataCenterPage's own reconciliationStatusVariant/Label mapping for
 * EtsyReconciliationStatus, so the cutover panel's badges read identically to
 * the existing reconciliation cards rather than inventing a new palette. */
export function entityStatusVariant(status: EtsyReconciliationStatus): BadgeVariant {
  if (status === "MATCHED") return "success";
  if (status === "MISMATCH") return "error";
  return "warning";
}

export function entityStatusLabel(status: EtsyReconciliationStatus): string {
  if (status === "MATCHED") return "Eşleşiyor";
  if (status === "MISMATCH") return "Fark var";
  return "Yetersiz veri";
}

/** Mirrors MonthlyFinancialReconciliationTable's own statusVariant/Label
 * mapping for FinancialMetricStatus. */
export function financialStatusVariant(status: FinancialMetricStatus): BadgeVariant {
  if (status === "MATCHED") return "success";
  if (status === "MISMATCH") return "error";
  if (status === "WARNING") return "warning";
  return "neutral";
}

export function financialStatusLabel(status: FinancialMetricStatus): string {
  if (status === "MATCHED") return "Eşleşiyor";
  if (status === "WARNING") return "Toleransta";
  if (status === "MISMATCH") return "Fark var";
  return "Yetersiz veri";
}

export function entityLabel(entity: FinancialCutoverEntity): string {
  return entity === "orders" ? "Orders" : "Payments";
}

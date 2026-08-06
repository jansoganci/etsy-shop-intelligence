import type { MonthlyFinancialEntry } from "../../../data/types/dataCenter";

/**
 * Faz6 "problem-only" view: drops fully-MATCHED metrics within a month, and
 * drops months left with nothing to show afterward. Never mutates the input.
 */
export function filterMonthsForProblemsOnly(months: MonthlyFinancialEntry[]): MonthlyFinancialEntry[] {
  return months
    .map((month) => ({ ...month, metrics: month.metrics.filter((metric) => metric.status !== "MATCHED") }))
    .filter((month) => month.metrics.length > 0);
}

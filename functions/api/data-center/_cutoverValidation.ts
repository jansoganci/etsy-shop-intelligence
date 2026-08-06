import type { EntityStatus } from "./_reconciliation";
import type { MetricStatus } from "./_financialReconciliation";

export type CutoverReadiness = {
  allowed: boolean;
  blockingReasons: string[];
  warnings: string[];
};

/**
 * Decides whether it is safe to flip a financial cutover flag on, reusing
 * the Reconciliation workstream's already-computed status fields rather than
 * re-deriving API-vs-CSV agreement:
 *
 * - `entityStatus` is the record-count-level status for this entity
 *   (ReconciliationResult.orders/.payments, Reconciliation Faz 1).
 * - `financialStatus` is the monthly financial (+ currency conversion,
 *   Reconciliation Faz 2/3) overall status. It is not split by entity, so it
 *   is applied to both orders and payments cutover decisions.
 *
 * MISMATCH and NOT_ENOUGH_DATA block by default -- cutting over to a source
 * that has never been confirmed to agree with CSV, or that is known to
 * disagree, is exactly the "premature cutover" risk this exists to prevent.
 * WARNING (within-tolerance rounding, etc.) does not block, but is surfaced.
 * The legacy `force` argument is retained for call-site compatibility but no
 * longer bypasses safety checks.
 */
export function evaluateCutoverReadiness(
  entityStatus: EntityStatus,
  financialStatus: MetricStatus,
  _force: boolean,
  syncInProgress = false,
  options: { paymentsResourceCompleted?: boolean | null } = {},
): CutoverReadiness {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  if (syncInProgress) {
    blockingReasons.push(
      "An Etsy sync is currently updating source data. Wait for it to finish before enabling API-first.",
    );
  }

  if (options.paymentsResourceCompleted === false) {
    blockingReasons.push(
      "Payments sync resource has not completed successfully yet.",
    );
  }

  if (entityStatus === "MISMATCH") {
    blockingReasons.push(
      "Record-level reconciliation reports a MISMATCH between API and CSV record counts.",
    );
  } else if (entityStatus === "NOT_ENOUGH_DATA") {
    blockingReasons.push(
      "Record-level reconciliation has not confirmed API and CSV agree yet (NOT_ENOUGH_DATA).",
    );
  }

  if (financialStatus === "MISMATCH") {
    blockingReasons.push("Monthly financial reconciliation reports a MISMATCH.");
  } else if (financialStatus === "NOT_ENOUGH_DATA") {
    blockingReasons.push(
      "Monthly financial reconciliation has not confirmed API and CSV agree yet (NOT_ENOUGH_DATA).",
    );
  } else if (financialStatus === "WARNING") {
    warnings.push(
      "Monthly financial reconciliation has warnings (differences within tolerance). Review before proceeding.",
    );
  }

  return {
    allowed: !syncInProgress && blockingReasons.length === 0,
    blockingReasons,
    warnings,
  };
}

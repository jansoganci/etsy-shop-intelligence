export type CommerceSummaryModalGate = {
  wasActive: boolean;
  isActive: boolean;
  isPeriodRun: boolean;
  runId: string | null | undefined;
  lastHandledRunId: string | null;
};

export function shouldOpenCommerceSummaryModal(input: CommerceSummaryModalGate): boolean {
  const { wasActive, isActive, isPeriodRun, runId, lastHandledRunId } = input;

  if (!wasActive || isActive || !isPeriodRun) {
    return false;
  }

  if (!runId || runId === lastHandledRunId) {
    return false;
  }

  return true;
}

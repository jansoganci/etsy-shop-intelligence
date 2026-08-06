/**
 * Etsy ledger -> USD, in TypeScript.
 *
 * The ledger holds every seller cost the payment-level figures miss:
 * advertising, the transaction commission, listing renewals, and the VAT Etsy
 * charges on its own services. Dashboard "Net Sales" is only
 * `gross - payment processing fee`, so it overstates what the shop actually
 * keeps — by 45% in 2026-05 on production data.
 *
 * Ledger amounts are minor units of the settlement currency (TRY) and, unlike
 * payments, carry no per-row USD anchor — there is no receipt to divide by. So
 * the rate comes from `v_ledger_daily_rate`: one rate per day, built from that
 * day's payments the same way migration 0027 builds a payment's own rate.
 *
 * The carry-forward and the conversion live here rather than in the view
 * because SQLite inlines views: resolving the rate per row re-ran the rate
 * aggregate 10,502 times and blew D1's CPU limit (see migration 0030). This
 * also mirrors `summarizePaymentFinancials` in `./_financials.ts`, which
 * already converts payment rows in TypeScript.
 */

/** A row of `v_ledger_daily_rate`. */
export type LedgerRateRow = {
  rateDate: string;
  settlementPerUsd: number | null;
};

/** A row of `v_ledger_canonical`. */
export type LedgerEntryRow = {
  entryDate: string;
  category: string | null;
  entryCurrency: string | null;
  amountTry: number | null;
};

export type LedgerSummary = {
  /** USD per category. Empty when the period could not be converted. */
  categoryUsd: Record<string, number>;
  /**
   * Everything the shop earned or spent, excluding money that only moved
   * (bank disbursements) or funded the balance. Null when any row in the
   * period could not be converted — unavailable rather than partial.
   */
  trueNetUsd: number | null;
  entryCount: number;
  unconvertibleCount: number;
  /** TRY movement over every row, convertible or not, for the balance check. */
  movementTry: number;
  /** Rows whose ledger_type this codebase does not know yet. */
  otherCategoryCount: number;
};

/**
 * Money that only changes location, and money the owner puts in. Neither is
 * income or cost, so neither belongs in True Net.
 */
export const NON_EARNING_CATEGORIES: ReadonlySet<string> = new Set([
  "disbursement",
  "funding",
]);

function isFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The rate in force on a given day: that day's own rate, else the most recent
 * earlier day that had one. Advertising is charged daily but some days have no
 * sale (6 of 31 in 2026-05), so a carry-forward is required. TRY moves ~0.1% a
 * day, so a one-to-three day carry costs cents.
 *
 * A day before the first rate returns null. No rate is extrapolated backwards.
 */
export function buildRateLookup(
  rates: ReadonlyArray<LedgerRateRow>,
): (entryDate: string) => number | null {
  const sorted = rates
    .filter((row) => isFinite(row.settlementPerUsd) && row.settlementPerUsd > 0)
    .map((row) => ({ date: row.rateDate, rate: row.settlementPerUsd as number }))
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  return (entryDate: string): number | null => {
    if (!entryDate || sorted.length === 0 || entryDate < sorted[0].date) {
      return null;
    }

    // Rightmost entry whose date is <= entryDate.
    let low = 0;
    let high = sorted.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].date <= entryDate) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return found === -1 ? null : sorted[found].rate;
  };
}

/**
 * Converts a period's ledger rows to USD and totals them by category.
 *
 * A row converts only when its amount is finite, its currency is TRY, and a
 * rate is in force on its date. Anything else counts as unconvertible and
 * forces `trueNetUsd` to null — the same "unavailable rather than guessed"
 * contract `summarizePaymentFinancials` applies to payments.
 */
export function summarizeLedger(
  entries: ReadonlyArray<LedgerEntryRow>,
  rates: ReadonlyArray<LedgerRateRow>,
): LedgerSummary {
  const rateFor = buildRateLookup(rates);
  const categoryUsd: Record<string, number> = {};

  let trueNetUsd = 0;
  let unconvertibleCount = 0;
  let movementTry = 0;
  let otherCategoryCount = 0;

  for (const entry of entries) {
    const category = entry.category?.trim() || "other";
    if (category === "other") {
      otherCategoryCount += 1;
    }

    if (isFinite(entry.amountTry)) {
      movementTry += entry.amountTry;
    }

    const currency = entry.entryCurrency?.trim().toUpperCase() ?? null;
    const rate = rateFor(entry.entryDate);

    if (!isFinite(entry.amountTry) || currency !== "TRY" || rate === null) {
      unconvertibleCount += 1;
      continue;
    }

    const usd = entry.amountTry / rate;
    categoryUsd[category] = (categoryUsd[category] ?? 0) + usd;

    if (!NON_EARNING_CATEGORIES.has(category)) {
      trueNetUsd += usd;
    }
  }

  const convertible = unconvertibleCount === 0;
  return {
    categoryUsd: convertible ? categoryUsd : {},
    trueNetUsd: convertible ? trueNetUsd : null,
    entryCount: entries.length,
    unconvertibleCount,
    movementTry,
    otherCategoryCount,
  };
}

/**
 * What Etsy took beyond the payment processing fee and advertising, derived so
 * the chain the dashboard shows always adds up:
 *
 *   netRevenue + adSpend + otherEtsyCosts === trueNet
 *
 * Taking it as a residual rather than summing the fee categories is deliberate.
 * `netRevenue` comes from the payment rows and `trueNet` from the ledger, and
 * the two differ by a period's refunds — the ledger reverses REFUND_GROSS and
 * gives the processing fee back, neither of which the payment rows see.
 * Measured on production: the literal category sum matches the residual to the
 * cent in every month with no refund (2026-07, -06, -05, -03, -02) and differs
 * by exactly the refund in the months that have one (2026-04 $3.55, 2026-01
 * $3.14). Summing categories would leave that gap visible on screen as an
 * arithmetic error; the residual absorbs it and stays honest, because the
 * refund really is money Etsy took back.
 *
 * The literal per-category breakdown is still published alongside for display.
 */
export function bridgeOtherEtsyCosts(
  netRevenueUsd: number | null,
  adSpendUsd: number | null,
  trueNetUsd: number | null,
): number | null {
  if (!isFinite(netRevenueUsd) || !isFinite(adSpendUsd) || !isFinite(trueNetUsd)) {
    return null;
  }
  return trueNetUsd - netRevenueUsd - adSpendUsd;
}

/**
 * The ledger's own consistency check: every entry carries a running balance, so
 * a period's summed movement must equal the balance it moved through. A
 * mismatch means rows are missing or duplicated, and the period's figures must
 * not be published.
 *
 * Production check: all 10,502 rows satisfy `previous balance + amount =
 * balance`, and 2026-05 movement 1,131.50 = closing 7,438.73 - opening
 * 6,307.23.
 */
export function ledgerBalanceReconciles(
  movementTry: number,
  openingBalanceTry: number | null,
  closingBalanceTry: number | null,
  toleranceTry = 0.02,
): boolean {
  if (!isFinite(openingBalanceTry) || !isFinite(closingBalanceTry)) {
    return false;
  }
  return Math.abs(closingBalanceTry - openingBalanceTry - movementTry) <= toleranceTry;
}

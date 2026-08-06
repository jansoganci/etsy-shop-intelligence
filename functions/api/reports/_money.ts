export type CurrencyTotalRow = {
  currency: string | null;
  amount: number | null;
};

export type MoneyValue = {
  amount: number;
  currency: string;
};

function normalizeCurrency(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : "Unknown";
}

export function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function formatMoney(amount: number, currency: string | null | undefined): string {
  const resolvedCurrency = normalizeCurrency(currency);

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: resolvedCurrency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${resolvedCurrency} ${amount.toFixed(2)}`;
  }
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "N/A";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(ratio);

  if (ratio > 0 && (formatted === "0%" || formatted === "0.0%")) {
    return "<0.01%";
  }

  return formatted;
}

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function normalizeMoneyRows(rows: CurrencyTotalRow[]): MoneyValue[] {
  return rows.map((row) => ({
    amount: toNumber(row.amount),
    currency: normalizeCurrency(row.currency),
  }));
}

export function collectMixedCurrencyWarning(
  rows: CurrencyTotalRow[],
  label: string,
): string | null {
  const currencies = Array.from(
    new Set(
      rows
        .map((row) => normalizeCurrency(row.currency))
        .filter((currency) => currency !== "Unknown"),
    ),
  );

  if (currencies.length <= 1) {
    return null;
  }

  return `${label} contains mixed currencies: ${currencies.join(", ")}.`;
}

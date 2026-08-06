export const TRAFFIC_SOURCE_KEYS = [
  "etsy_app_and_other_pages",
  "etsy_search",
  "etsy_marketing_and_seo",
  "direct_and_other_traffic",
  "social_media",
  "etsy_ads",
] as const;

export type TrafficSourceKey = (typeof TRAFFIC_SOURCE_KEYS)[number];

export type MonthlyTrafficSourceInput = {
  visits: number;
  sharePercent: number | null;
};

export type MonthlyStatsInput = {
  month: string;
  currency: "USD";
  visits: number;
  orders: number;
  conversionRate: number;
  revenue: number;
  itemFavorites: number;
  shopFollows: number;
  reviews: number;
  repeatBuyers: number;
  citiesReached: number;
  abandonedCarts: number;
  trafficSources: Record<TrafficSourceKey, MonthlyTrafficSourceInput>;
  notes: string | null;
};

export type MonthlyStatsValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: MonthlyStatsInput | null;
};

type ValidationOptions = {
  now?: Date;
  expectedMonth?: string;
};

const ROOT_KEYS = new Set([
  "month",
  "currency",
  "visits",
  "orders",
  "conversionRate",
  "revenue",
  "itemFavorites",
  "shopFollows",
  "reviews",
  "repeatBuyers",
  "citiesReached",
  "abandonedCarts",
  "trafficSources",
  "notes",
]);

const INTEGER_FIELDS = [
  "visits",
  "orders",
  "itemFavorites",
  "shopFollows",
  "reviews",
  "repeatBuyers",
  "citiesReached",
  "abandonedCarts",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function isValidMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function readNonNegativeNumber(
  source: Record<string, unknown>,
  key: string,
  errors: string[],
  options: { integer?: boolean; maximum?: number } = {},
): number | null {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${key} must be a non-negative number.`);
    return null;
  }

  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${key} must be a whole number.`);
    return null;
  }

  if (options.maximum !== undefined && value > options.maximum) {
    errors.push(`${key} must be at most ${options.maximum}.`);
    return null;
  }

  return value;
}

export function validateMonthlyStats(
  input: unknown,
  options: ValidationOptions = {},
): MonthlyStatsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: ["The payload must be a JSON object."],
      warnings,
      normalized: null,
    };
  }

  const unexpectedKeys = Object.keys(input).filter((key) => !ROOT_KEYS.has(key));
  if (unexpectedKeys.length > 0) {
    errors.push(`Unexpected field(s): ${unexpectedKeys.join(", ")}.`);
  }

  const month = typeof input.month === "string" ? input.month.trim() : "";
  if (!isValidMonth(month)) {
    errors.push("month must use YYYY-MM format.");
  } else {
    const maximumMonth = currentMonth(options.now ?? new Date());
    if (month >= maximumMonth) {
      errors.push("month must be a completed calendar month.");
    }
    if (options.expectedMonth && month !== options.expectedMonth) {
      errors.push(`month must match the URL month ${options.expectedMonth}.`);
    }
  }

  if (input.currency !== "USD") {
    errors.push("currency must be USD.");
  }

  const numericValues: Partial<Record<(typeof INTEGER_FIELDS)[number], number>> = {};
  for (const field of INTEGER_FIELDS) {
    const value = readNonNegativeNumber(input, field, errors, { integer: true });
    if (value !== null) {
      numericValues[field] = value;
    }
  }

  const conversionRate = readNonNegativeNumber(input, "conversionRate", errors, {
    maximum: 100,
  });
  const revenue = readNonNegativeNumber(input, "revenue", errors);

  const trafficSourcesInput = input.trafficSources;
  const normalizedTrafficSources = {} as Record<TrafficSourceKey, MonthlyTrafficSourceInput>;

  if (!isRecord(trafficSourcesInput)) {
    errors.push("trafficSources must be an object.");
  } else {
    const unexpectedSourceKeys = Object.keys(trafficSourcesInput).filter(
      (key) => !TRAFFIC_SOURCE_KEYS.includes(key as TrafficSourceKey),
    );
    if (unexpectedSourceKeys.length > 0) {
      errors.push(`Unexpected traffic source(s): ${unexpectedSourceKeys.join(", ")}.`);
    }

    for (const sourceKey of TRAFFIC_SOURCE_KEYS) {
      const sourceValue = trafficSourcesInput[sourceKey];
      if (!isRecord(sourceValue)) {
        errors.push(`trafficSources.${sourceKey} must be an object.`);
        continue;
      }

      const visits = readNonNegativeNumber(sourceValue, "visits", errors, { integer: true });
      const rawShare = sourceValue.sharePercent;
      let sharePercent: number | null = null;

      if (rawShare !== null && rawShare !== undefined) {
        const parsedShare = readNonNegativeNumber(sourceValue, "sharePercent", errors, {
          maximum: 100,
        });
        if (parsedShare !== null) {
          sharePercent = parsedShare;
        }
      }

      if (visits !== null) {
        normalizedTrafficSources[sourceKey] = { visits, sharePercent };
      }
    }
  }

  let notes: string | null = null;
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string") {
      errors.push("notes must be a string or null.");
    } else if (input.notes.trim().length > 1000) {
      errors.push("notes must be 1000 characters or fewer.");
    } else {
      notes = input.notes.trim() || null;
    }
  }

  const visits = numericValues.visits;
  const orders = numericValues.orders;
  if (
    visits !== undefined &&
    orders !== undefined &&
    conversionRate !== null &&
    visits > 0
  ) {
    const calculatedRate = (orders / visits) * 100;
    if (Math.abs(calculatedRate - conversionRate) > 0.25) {
      warnings.push(
        `conversionRate differs from orders / visits (${calculatedRate.toFixed(2)}%).`,
      );
    }
  }

  if (visits === 0 && orders !== undefined && orders > 0) {
    warnings.push("orders is greater than zero while visits is zero.");
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, normalized: null };
  }

  return {
    valid: true,
    errors,
    warnings,
    normalized: {
      month,
      currency: "USD",
      visits: numericValues.visits!,
      orders: numericValues.orders!,
      conversionRate: conversionRate!,
      revenue: revenue!,
      itemFavorites: numericValues.itemFavorites!,
      shopFollows: numericValues.shopFollows!,
      reviews: numericValues.reviews!,
      repeatBuyers: numericValues.repeatBuyers!,
      citiesReached: numericValues.citiesReached!,
      abandonedCarts: numericValues.abandonedCarts!,
      trafficSources: normalizedTrafficSources,
      notes,
    },
  };
}

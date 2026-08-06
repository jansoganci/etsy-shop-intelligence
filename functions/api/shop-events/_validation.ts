export const EVENT_TYPES = [
  "new_listing",
  "title_change",
  "seo_change",
  "description_change",
  "alt_text_change",
  "price_change",
  "discount_start",
  "discount_rate_change",
  "discount_end",
  "manual_note",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const DISCOUNT_EVENT_TYPES: EventType[] = ["discount_start", "discount_rate_change"];

export type ShopEventInput = {
  eventDate: string;
  eventType: EventType;
  listingId: string | null;
  oldValue: string | null;
  newValue: string | null;
  discountRate: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  note: string | null;
};

export type ShopEventValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: ShopEventInput | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const ROOT_KEYS = new Set([
  "eventDate",
  "eventType",
  "listingId",
  "oldValue",
  "newValue",
  "discountRate",
  "dateFrom",
  "dateTo",
  "note",
]);

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  errors: string[],
  options: { maxLength?: number } = {},
): string | null {
  const value = source[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${key} must be a string or null.`);
    return null;
  }
  const trimmed = value.trim();
  if (options.maxLength && trimmed.length > options.maxLength) {
    errors.push(`${key} must be at most ${options.maxLength} characters.`);
    return null;
  }
  return trimmed || null;
}

export function validateShopEvent(input: unknown): ShopEventValidationResult {
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

  const eventDate = typeof input.eventDate === "string" ? input.eventDate.trim() : "";
  if (!isIsoDate(eventDate)) {
    errors.push("eventDate must use YYYY-MM-DD format.");
  }

  const eventType = EVENT_TYPES.includes(input.eventType as EventType)
    ? (input.eventType as EventType)
    : null;
  if (!eventType) {
    errors.push(`eventType must be one of: ${EVENT_TYPES.join(", ")}.`);
  }

  const listingId = readOptionalString(input, "listingId", errors);
  if (eventType && eventType !== "manual_note" && eventType !== "new_listing" && !listingId) {
    warnings.push(`${eventType} usually applies to a specific listing.`);
  }

  const oldValue = readOptionalString(input, "oldValue", errors, { maxLength: 2000 });
  const newValue = readOptionalString(input, "newValue", errors, { maxLength: 2000 });
  const note = readOptionalString(input, "note", errors, { maxLength: 1000 });

  let discountRate: number | null = null;
  if (input.discountRate !== undefined && input.discountRate !== null) {
    if (
      typeof input.discountRate !== "number" ||
      !Number.isFinite(input.discountRate) ||
      input.discountRate < 0 ||
      input.discountRate > 100
    ) {
      errors.push("discountRate must be a number between 0 and 100.");
    } else {
      discountRate = input.discountRate;
    }
  }

  const dateFrom = readOptionalString(input, "dateFrom", errors);
  if (dateFrom && !isIsoDate(dateFrom)) {
    errors.push("dateFrom must use YYYY-MM-DD format.");
  }
  const dateTo = readOptionalString(input, "dateTo", errors);
  if (dateTo && !isIsoDate(dateTo)) {
    errors.push("dateTo must use YYYY-MM-DD format.");
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    errors.push("dateFrom must not be after dateTo.");
  }

  if (eventType && DISCOUNT_EVENT_TYPES.includes(eventType) && discountRate === null) {
    errors.push(`${eventType} requires discountRate.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, normalized: null };
  }

  return {
    valid: true,
    errors,
    warnings,
    normalized: {
      eventDate,
      eventType: eventType!,
      listingId,
      oldValue,
      newValue,
      discountRate,
      dateFrom,
      dateTo,
      note,
    },
  };
}

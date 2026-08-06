export type ListingInput = {
  listingId: string;
  url: string;
  title: string;
  tags: string[];
  description: string;
  imageAltTexts: string[];
  price: number;
  currency: "USD";
  status: "active" | "inactive";
  effectiveAt: string;
  changeNote: string | null;
};

export type ListingValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: ListingInput | null;
};

type ValidationOptions = {
  now?: Date;
  expectedListingId?: string;
};

const ROOT_KEYS = new Set([
  "listingId",
  "url",
  "title",
  "tags",
  "description",
  "imageAltTexts",
  "price",
  "currency",
  "status",
  "effectiveAt",
  "changeNote",
]);

const ETSY_LISTING_URL_PATTERN =
  /^https:\/\/www\.etsy\.com\/listing\/(\d+)(\/[^?#]*)?(\?[^#]*)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function validateListing(
  input: unknown,
  options: ValidationOptions = {},
): ListingValidationResult {
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

  const url = typeof input.url === "string" ? input.url.trim() : "";
  const urlMatch = ETSY_LISTING_URL_PATTERN.exec(url);
  if (!urlMatch) {
    errors.push(
      "url must be a public Etsy listing URL (https://www.etsy.com/listing/{id}/...).",
    );
  }

  const listingId = typeof input.listingId === "string" ? input.listingId.trim() : "";
  if (!/^\d+$/.test(listingId)) {
    errors.push("listingId must be numeric.");
  } else if (urlMatch && urlMatch[1] !== listingId) {
    errors.push(`listingId must match the numeric id in url (${urlMatch[1]}).`);
  }

  if (options.expectedListingId && listingId && listingId !== options.expectedListingId) {
    errors.push(`listingId must match the URL listingId ${options.expectedListingId}.`);
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    errors.push("title is required.");
  } else if (title.length > 140) {
    errors.push("title must be at most 140 characters.");
  }

  let tags: string[] = [];
  if (!isStringArray(input.tags)) {
    errors.push("tags must be an array of strings.");
  } else {
    tags = input.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (tags.length > 13) {
      errors.push("tags must contain at most 13 entries.");
    }

    const oversizedTag = tags.find((tag) => tag.length > 20);
    if (oversizedTag) {
      errors.push(`tag "${oversizedTag}" exceeds 20 characters.`);
    }
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) {
    errors.push("description is required.");
  } else if (description.length > 20000) {
    errors.push("description must be at most 20000 characters.");
  }

  let imageAltTexts: string[] = [];
  if (!isStringArray(input.imageAltTexts)) {
    errors.push("imageAltTexts must be an array of strings.");
  } else {
    imageAltTexts = input.imageAltTexts
      .filter((text): text is string => typeof text === "string")
      .map((text) => text.trim())
      .filter(Boolean);

    if (imageAltTexts.length === 0) {
      warnings.push("No image alt texts were provided.");
    }
  }

  const price =
    typeof input.price === "number" && Number.isFinite(input.price) && input.price >= 0
      ? input.price
      : null;
  if (price === null) {
    errors.push("price must be a non-negative number.");
  }

  if (input.currency !== "USD") {
    errors.push("currency must be USD.");
  }

  const status = input.status === "active" || input.status === "inactive" ? input.status : null;
  if (!status) {
    errors.push('status must be "active" or "inactive".');
  }

  const effectiveAt = typeof input.effectiveAt === "string" ? input.effectiveAt.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveAt)) {
    errors.push("effectiveAt must use YYYY-MM-DD format.");
  } else {
    const today = (options.now ?? new Date()).toISOString().slice(0, 10);
    if (effectiveAt > today) {
      errors.push("effectiveAt cannot be in the future.");
    }
  }

  let changeNote: string | null = null;
  if (input.changeNote !== undefined && input.changeNote !== null) {
    if (typeof input.changeNote !== "string") {
      errors.push("changeNote must be a string or null.");
    } else if (input.changeNote.trim().length > 1000) {
      errors.push("changeNote must be at most 1000 characters.");
    } else {
      changeNote = input.changeNote.trim() || null;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, normalized: null };
  }

  return {
    valid: true,
    errors,
    warnings,
    normalized: {
      listingId,
      url,
      title,
      tags,
      description,
      imageAltTexts,
      price: price!,
      currency: "USD",
      status: status!,
      effectiveAt,
      changeNote,
    },
  };
}

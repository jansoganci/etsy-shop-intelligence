export const MEMORY_TYPES = [
  "goal",
  "preference",
  "decision",
  "experiment",
  "result",
  "avoid_suggestion",
  "shop_info",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

export type MemoryInput = {
  memoryType: MemoryType;
  content: string;
  importance: string | null;
};

export type MemoryValidationResult = {
  valid: boolean;
  errors: string[];
  normalized: MemoryInput | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ROOT_KEYS = new Set(["memoryType", "content", "importance"]);
const CONTENT_MAX_LENGTH = 2000;

export function validateMemoryInput(input: unknown): MemoryValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: ["The payload must be a JSON object."], normalized: null };
  }

  const unexpectedKeys = Object.keys(input).filter((key) => !ROOT_KEYS.has(key));
  if (unexpectedKeys.length > 0) {
    errors.push(`Unexpected field(s): ${unexpectedKeys.join(", ")}.`);
  }

  if (!isMemoryType(input.memoryType)) {
    errors.push(`memoryType must be one of: ${MEMORY_TYPES.join(", ")}.`);
  }

  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) {
    errors.push("content must be a non-empty string.");
  } else if (content.length > CONTENT_MAX_LENGTH) {
    errors.push(`content must be at most ${CONTENT_MAX_LENGTH} characters.`);
  }

  let importance: string | null = null;
  if (input.importance !== undefined && input.importance !== null) {
    if (typeof input.importance !== "string") {
      errors.push("importance must be a string or null.");
    } else {
      importance = input.importance.trim() || null;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors,
    normalized: {
      memoryType: input.memoryType as MemoryType,
      content,
      importance,
    },
  };
}

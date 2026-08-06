export const ALLOWED_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  model: AllowedModel;
  messages: ChatMessage[];
  detailed: boolean;
};

export type ChatValidationResult = {
  valid: boolean;
  errors: string[];
  normalized: ChatRequest | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateChatRequest(input: unknown): ChatValidationResult {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: ["The payload must be a JSON object."], normalized: null };
  }

  const model = ALLOWED_MODELS.includes(input.model as AllowedModel)
    ? (input.model as AllowedModel)
    : null;
  if (!model) {
    errors.push(`model must be one of: ${ALLOWED_MODELS.join(", ")}.`);
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    errors.push("messages must be a non-empty array.");
  }

  const messages: ChatMessage[] = [];
  if (Array.isArray(input.messages)) {
    if (input.messages.length > 40) {
      errors.push("messages must contain at most 40 entries.");
    }
    for (const [index, entry] of input.messages.entries()) {
      if (!isRecord(entry)) {
        errors.push(`messages[${index}] must be an object.`);
        continue;
      }
      if (entry.role !== "user" && entry.role !== "assistant") {
        errors.push(`messages[${index}].role must be "user" or "assistant".`);
        continue;
      }
      if (typeof entry.content !== "string" || !entry.content.trim()) {
        errors.push(`messages[${index}].content must be a non-empty string.`);
        continue;
      }
      if (entry.content.length > 4000) {
        errors.push(`messages[${index}].content must be at most 4000 characters.`);
        continue;
      }
      messages.push({ role: entry.role, content: entry.content });
    }
  }

  const lastMessage = messages[messages.length - 1];
  if (messages.length > 0 && lastMessage?.role !== "user") {
    errors.push("The last message must have role \"user\".");
  }

  const detailed = input.detailed === true;

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors,
    normalized: { model: model!, messages, detailed },
  };
}

export const AI_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const DEFAULT_AI_MODEL: AiModel = "deepseek-v4-flash";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  isError?: boolean;
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  durationMs: number;
};

export type ChatResponse = {
  message: string;
  model: AiModel;
  usage: ChatUsage;
};

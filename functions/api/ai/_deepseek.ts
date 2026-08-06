import { TOOL_DEFINITIONS, executeTool, isKnownTool } from "./_tools";
import type { D1Database } from "./_d1";
import type { ChatMessage } from "./_validation";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MAX_TOOL_ROUNDS = 4;
const REQUEST_TIMEOUT_MS = 30_000;

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
};

type DeepSeekResponse = {
  choices: Array<{
    message: DeepSeekMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export type ChatOutcome = {
  status: "ok" | "error" | "timeout" | "rate_limited";
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  errorCode?: string;
};

async function callDeepSeek(
  apiKey: string,
  model: string,
  messages: DeepSeekMessage[],
  maxTokens: number,
): Promise<DeepSeekResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new RateLimitError();
    }

    if (!response.ok) {
      throw new Error(`DeepSeek API returned ${response.status}`);
    }

    return (await response.json()) as DeepSeekResponse;
  } finally {
    clearTimeout(timeout);
  }
}

class RateLimitError extends Error {
  constructor() {
    super("DeepSeek API rate limit exceeded.");
  }
}

export async function runChat(options: {
  db: D1Database;
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: ChatMessage[];
  detailed: boolean;
}): Promise<ChatOutcome> {
  const { db, apiKey, model, systemPrompt, history, detailed } = options;
  // DeepSeek's completion_tokens covers hidden reasoning as well as visible
  // output, so a tight ceiling can exhaust itself mid tool-call decision and
  // truncate before any real answer text is emitted. Give every round enough
  // headroom to survive that; the system prompt (not this ceiling) is what
  // keeps short-mode answers short.
  const maxTokens = detailed ? 2000 : 1200;

  const messages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((message) => ({ role: message.role, content: message.content })),
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await callDeepSeek(apiKey, model, messages, maxTokens);
      const usage = response.usage;
      inputTokens += usage?.prompt_tokens ?? 0;
      outputTokens += usage?.completion_tokens ?? 0;

      const choice = response.choices[0];
      if (!choice) {
        return { status: "error", text: null, inputTokens, outputTokens, toolCallCount, errorCode: "empty_response" };
      }

      const toolCalls = choice.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return {
          status: "ok",
          text: choice.message.content ?? "",
          inputTokens,
          outputTokens,
          toolCallCount,
        };
      }

      messages.push({
        role: "assistant",
        content: choice.message.content ?? null,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        toolCallCount += 1;
        let args: unknown = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = isKnownTool(toolCall.function.name)
          ? await executeTool(db, toolCall.function.name, args)
          : { error: "unknown_tool" };

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    return {
      status: "error",
      text: null,
      inputTokens,
      outputTokens,
      toolCallCount,
      errorCode: "tool_round_limit_exceeded",
    };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { status: "rate_limited", text: null, inputTokens, outputTokens, toolCallCount, errorCode: "rate_limited" };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "timeout", text: null, inputTokens, outputTokens, toolCallCount, errorCode: "timeout" };
    }
    return {
      status: "error",
      text: null,
      inputTokens,
      outputTokens,
      toolCallCount,
      errorCode: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

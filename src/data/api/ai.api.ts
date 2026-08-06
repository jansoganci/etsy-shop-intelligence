import type { AiModel, ChatMessage, ChatResponse } from "../types/ai";

type ApiFailure = {
  ok: false;
  error?: string;
  message?: string;
  errors?: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Server returned an invalid response.");
  }
}

function failureMessage(failure: ApiFailure, fallback: string): string {
  return failure.message || failure.errors?.join(" ") || fallback;
}

export async function sendChatMessage(
  model: AiModel,
  messages: ChatMessage[],
  detailed: boolean,
): Promise<ChatResponse> {
  let response: Response;
  try {
    response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        detailed,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      }),
    });
  } catch {
    throw new Error("AI Analyst'e bağlanılamadı (ağ hatası).");
  }

  const data = await readJson<
    ({ ok: true } & ChatResponse) | ApiFailure
  >(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "AI cevap üretemedi."));
  }

  return { message: data.message, model: data.model, usage: data.usage };
}

import { validateChatRequest } from "./_validation";
import { buildSystemPrompt } from "./_systemPrompt";
import { runChat } from "./_deepseek";
import { logAiUsage } from "./_usage";
import type { D1Database } from "./_d1";

type Context = {
  request: Request;
  env: { DB: D1Database; DEEPSEEK_API_KEY?: string };
};

const ERROR_MESSAGES: Record<string, string> = {
  timeout: "DeepSeek yanıt vermedi (zaman aşımı). Tekrar dener misin?",
  rate_limited: "DeepSeek şu an çok yoğun (rate limit). Birkaç saniye sonra tekrar dene.",
  tool_round_limit_exceeded: "Bu soru çok fazla veri sorgusu gerektirdi. Soruyu daraltıp tekrar dener misin?",
  empty_response: "DeepSeek boş bir yanıt döndürdü. Tekrar dener misin?",
};

export async function onRequestPost(context: Context): Promise<Response> {
  if (!context.env.DEEPSEEK_API_KEY) {
    return Response.json(
      { ok: false, error: "missing_api_key", message: "DeepSeek API anahtarı yapılandırılmamış." },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json", message: "The request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const validation = validateChatRequest(payload);
  if (!validation.valid || !validation.normalized) {
    return Response.json(
      { ok: false, error: "validation_failed", errors: validation.errors },
      { status: 422 },
    );
  }

  const { model, messages, detailed } = validation.normalized;
  const startedAt = Date.now();

  const outcome = await runChat({
    db: context.env.DB,
    apiKey: context.env.DEEPSEEK_API_KEY,
    model,
    systemPrompt: buildSystemPrompt(),
    history: messages,
    detailed,
  });

  const durationMs = Date.now() - startedAt;

  try {
    await logAiUsage(context.env.DB, {
      model,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      toolCallCount: outcome.toolCallCount,
      durationMs,
      status: outcome.status,
      errorCode: outcome.errorCode,
    });
  } catch (error) {
    console.error("ai_usage_log_failed", error);
  }

  if (outcome.status !== "ok" || outcome.text === null) {
    return Response.json(
      {
        ok: false,
        error: outcome.errorCode ?? "chat_failed",
        message: ERROR_MESSAGES[outcome.errorCode ?? ""] ?? "AI cevap üretemedi. Tekrar dener misin?",
      },
      { status: outcome.status === "rate_limited" ? 429 : 502 },
    );
  }

  return Response.json({
    ok: true,
    message: outcome.text,
    model,
    usage: {
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      toolCallCount: outcome.toolCallCount,
      durationMs,
    },
  });
}

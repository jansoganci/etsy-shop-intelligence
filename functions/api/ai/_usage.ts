import type { D1Database } from "./_d1";

export async function logAiUsage(
  db: D1Database,
  entry: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    toolCallCount: number;
    durationMs: number;
    status: "ok" | "error" | "timeout" | "rate_limited";
    errorCode?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO ai_usage_logs (
          model, input_tokens, output_tokens, tool_call_count, duration_ms, status, error_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.toolCallCount,
      entry.durationMs,
      entry.status,
      entry.errorCode ?? null,
    )
    .run();
}

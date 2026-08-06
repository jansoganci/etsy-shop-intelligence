import { describe, expect, it } from "vitest";
import { validateChatRequest } from "./_validation";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "Haziran satışlarım neden düştü?" }],
    detailed: false,
    ...overrides,
  };
}

describe("validateChatRequest", () => {
  it("accepts a well-formed request", () => {
    const result = validateChatRequest(validPayload());

    expect(result.valid).toBe(true);
    expect(result.normalized?.model).toBe("deepseek-v4-flash");
  });

  it("rejects a non-object payload", () => {
    const result = validateChatRequest("nope");

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });

  it("rejects an invalid model", () => {
    const result = validateChatRequest(validPayload({ model: "gpt-4" }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("model"))).toBe(true);
  });

  it("rejects an empty messages array", () => {
    const result = validateChatRequest(validPayload({ messages: [] }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("non-empty array"))).toBe(true);
  });

  it("rejects more than 40 messages", () => {
    const messages = Array.from({ length: 41 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "hi",
    }));
    const result = validateChatRequest(validPayload({ messages }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("at most 40"))).toBe(true);
  });

  it("rejects a message with an invalid role", () => {
    const result = validateChatRequest(
      validPayload({ messages: [{ role: "system", content: "hi" }] }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("role"))).toBe(true);
  });

  it("rejects an empty message content", () => {
    const result = validateChatRequest(
      validPayload({ messages: [{ role: "user", content: "   " }] }),
    );

    expect(result.valid).toBe(false);
  });

  it("rejects message content longer than 4000 characters", () => {
    const result = validateChatRequest(
      validPayload({ messages: [{ role: "user", content: "x".repeat(4001) }] }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("4000"))).toBe(true);
  });

  it("rejects a conversation that does not end with a user message", () => {
    const result = validateChatRequest(
      validPayload({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("last message"))).toBe(true);
  });

  it("defaults detailed to false when omitted", () => {
    const { detailed, ...rest } = validPayload();
    const result = validateChatRequest(rest);

    expect(result.valid).toBe(true);
    expect(result.normalized?.detailed).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isMemoryType, validateMemoryInput } from "./_validation";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    memoryType: "goal",
    content: "Günlük 3-5 satış hedefim var.",
    importance: null,
    ...overrides,
  };
}

describe("validateMemoryInput", () => {
  it("accepts a well-formed memory", () => {
    const result = validateMemoryInput(validPayload());

    expect(result.valid).toBe(true);
    expect(result.normalized?.memoryType).toBe("goal");
    expect(result.normalized?.content).toBe("Günlük 3-5 satış hedefim var.");
  });

  it("trims content", () => {
    const result = validateMemoryInput(validPayload({ content: "  Not al: test  " }));

    expect(result.valid).toBe(true);
    expect(result.normalized?.content).toBe("Not al: test");
  });

  it("rejects an invalid memoryType", () => {
    const result = validateMemoryInput(validPayload({ memoryType: "made_up_type" }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("memoryType"))).toBe(true);
  });

  it("rejects empty content", () => {
    const result = validateMemoryInput(validPayload({ content: "   " }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("content must be a non-empty string.");
  });

  it("rejects content over 2000 characters", () => {
    const result = validateMemoryInput(validPayload({ content: "a".repeat(2001) }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("2000"))).toBe(true);
  });

  it("accepts a null importance", () => {
    const result = validateMemoryInput(validPayload({ importance: null }));

    expect(result.valid).toBe(true);
    expect(result.normalized?.importance).toBeNull();
  });

  it("rejects unexpected top-level fields", () => {
    const result = validateMemoryInput(validPayload({ extra: true }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => message.includes("extra"))).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = validateMemoryInput("not an object");

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });
});

describe("isMemoryType", () => {
  it("recognizes valid memory types", () => {
    expect(isMemoryType("goal")).toBe(true);
    expect(isMemoryType("avoid_suggestion")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isMemoryType("made_up_type")).toBe(false);
    expect(isMemoryType(123)).toBe(false);
    expect(isMemoryType(undefined)).toBe(false);
  });
});

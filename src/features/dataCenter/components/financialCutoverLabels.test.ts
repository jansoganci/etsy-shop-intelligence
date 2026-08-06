import { describe, expect, it } from "vitest";
import {
  entityLabel,
  entityStatusLabel,
  entityStatusVariant,
  financialStatusLabel,
  financialStatusVariant,
} from "./financialCutoverLabels";

describe("entityStatusVariant / entityStatusLabel", () => {
  it("maps MATCHED to success", () => {
    expect(entityStatusVariant("MATCHED")).toBe("success");
    expect(entityStatusLabel("MATCHED")).toBe("Eşleşiyor");
  });

  it("maps MISMATCH to error", () => {
    expect(entityStatusVariant("MISMATCH")).toBe("error");
    expect(entityStatusLabel("MISMATCH")).toBe("Fark var");
  });

  it("maps NOT_ENOUGH_DATA to warning", () => {
    expect(entityStatusVariant("NOT_ENOUGH_DATA")).toBe("warning");
    expect(entityStatusLabel("NOT_ENOUGH_DATA")).toBe("Yetersiz veri");
  });
});

describe("financialStatusVariant / financialStatusLabel", () => {
  it("maps MATCHED to success", () => {
    expect(financialStatusVariant("MATCHED")).toBe("success");
    expect(financialStatusLabel("MATCHED")).toBe("Eşleşiyor");
  });

  it("maps WARNING to warning (distinct from MISMATCH)", () => {
    expect(financialStatusVariant("WARNING")).toBe("warning");
    expect(financialStatusLabel("WARNING")).toBe("Toleransta");
  });

  it("maps MISMATCH to error", () => {
    expect(financialStatusVariant("MISMATCH")).toBe("error");
    expect(financialStatusLabel("MISMATCH")).toBe("Fark var");
  });

  it("maps NOT_ENOUGH_DATA to neutral", () => {
    expect(financialStatusVariant("NOT_ENOUGH_DATA")).toBe("neutral");
    expect(financialStatusLabel("NOT_ENOUGH_DATA")).toBe("Yetersiz veri");
  });
});

describe("entityLabel", () => {
  it("labels orders and payments", () => {
    expect(entityLabel("orders")).toBe("Orders");
    expect(entityLabel("payments")).toBe("Payments");
  });
});

import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { FullSchemaTestD1 } from "../test/testD1";
import {
  cancelReconciliationRun,
  createManualReconciliationRun,
  executeReconciliationRun,
  financialIssue,
  ReconciliationSourceBusyError,
  reasonCodeForIssue,
  reasonCodeForMetric,
  severityForIssue,
  severityForMetric,
} from "./run";

function testEnv(db: FullSchemaTestD1) {
  const messages: unknown[] = [];
  return {
    env: {
      DB: db,
      ETSY_SYNC_QUEUE: { send: async (message: unknown) => { messages.push(message); } },
    } as unknown as Env,
    messages,
  };
}

function seedConnectedShop(db: FullSchemaTestD1) {
  db.sqlite.prepare(
    `
      INSERT INTO etsy_connections (
        shop_id, etsy_user_id, scopes_json, access_token_ciphertext,
        access_token_iv, refresh_token_ciphertext, refresh_token_iv,
        access_token_expires_at, status
      ) VALUES ('shop', 'user', '[]', 'a', 'i', 'r', 'i', '2099-01-01', 'connected')
    `,
  ).run();
}

describe("reconciliation run pipeline", () => {
  it("rejects a manual run while a CSV import is active", async () => {
    const db = new FullSchemaTestD1();
    seedConnectedShop(db);
    const { env } = testEnv(db);
    db.sqlite.prepare(
      "INSERT INTO imports (import_type,row_count,status) VALUES ('orders',1,'importing')",
    ).run();

    await expect(createManualReconciliationRun(env)).rejects.toBeInstanceOf(
      ReconciliationSourceBusyError,
    );
  });

  it("creates one active manual run and writes an outbox Queue message", async () => {
    const db = new FullSchemaTestD1();
    seedConnectedShop(db);
    const { env, messages } = testEnv(db);

    const first = await createManualReconciliationRun(env);
    const second = await createManualReconciliationRun(env);

    expect(first?.status).toBe("queued");
    expect(second?.id).toBe(first?.id);
    expect(messages).toEqual([{ kind: "reconciliation", runId: first?.id }]);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_reconciliation_runs").get(),
    ).toEqual({ count: 1 });
  });

  it("cancels a queued run before Queue delivery without changing a prior completed run", async () => {
    const db = new FullSchemaTestD1();
    seedConnectedShop(db);
    const { env } = testEnv(db);
    db.sqlite.prepare(
      `
        INSERT INTO etsy_reconciliation_runs (
          id, shop_id, status, trigger_type, reporting_timezone, rules_version,
          summary_json, completed_at
        ) VALUES ('previous', 'shop', 'completed', 'manual', 'Europe/Istanbul', 'test', '{}', CURRENT_TIMESTAMP)
      `,
    ).run();
    const run = await createManualReconciliationRun(env);

    expect(await cancelReconciliationRun(env, run!.id)).toBe(true);
    await executeReconciliationRun(env, { kind: "reconciliation", runId: run!.id });

    expect(
      db.sqlite.prepare("SELECT status FROM etsy_reconciliation_runs WHERE id=?").get(run!.id),
    ).toEqual({ status: "cancelled" });
    expect(
      db.sqlite.prepare("SELECT status, summary_json FROM etsy_reconciliation_runs WHERE id='previous'").get(),
    ).toEqual({ status: "completed", summary_json: "{}" });
  });

  it("fails with source_changed_during_run and preserves the previous completed result", async () => {
    const db = new FullSchemaTestD1();
    seedConnectedShop(db);
    const { env } = testEnv(db);
    db.sqlite.prepare(
      `
        INSERT INTO etsy_reconciliation_runs (
          id, shop_id, status, trigger_type, reporting_timezone, rules_version,
          summary_json, completed_at
        ) VALUES ('previous', 'shop', 'completed', 'manual', 'Europe/Istanbul', 'test', '{}', CURRENT_TIMESTAMP)
      `,
    ).run();
    const run = await createManualReconciliationRun(env);
    db.sqlite.prepare(
      "INSERT INTO imports (import_type,row_count,status) VALUES ('payments',1,'processing')",
    ).run();

    await executeReconciliationRun(env, { kind: "reconciliation", runId: run!.id });

    expect(
      db.sqlite.prepare("SELECT status,error_code FROM etsy_reconciliation_runs WHERE id=?").get(run!.id),
    ).toEqual({ status: "failed", error_code: "source_changed_during_run" });
    expect(
      db.sqlite.prepare("SELECT status,summary_json FROM etsy_reconciliation_runs WHERE id='previous'").get(),
    ).toEqual({ status: "completed", summary_json: "{}" });
  });

  it("persists exact-ID missing-record issues with stable severity and runs a shadow comparison", async () => {
    const db = new FullSchemaTestD1();
    seedConnectedShop(db);
    const { env } = testEnv(db);
    db.sqlite.prepare(
      `
        INSERT INTO etsy_api_shops (shop_id, user_id, shop_name, synced_at)
        VALUES ('shop', 'user', 'Test shop', CURRENT_TIMESTAMP)
      `,
    ).run();
    db.sqlite.prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, create_timestamp, total_price_amount,
          total_price_divisor, total_price_currency, synced_at
        ) VALUES ('api-only', 'shop', 1767225600, 1000, 100, 'USD', CURRENT_TIMESTAMP)
      `,
    ).run();
    db.sqlite.prepare(
      `
        INSERT INTO imports (import_type, file_name, file_hash, row_count, status, completed_at)
        VALUES ('orders', 'orders.csv', 'orders-test', 1, 'completed', CURRENT_TIMESTAMP)
      `,
    ).run();
    db.sqlite.prepare(
      `
        INSERT INTO orders (order_id, sale_date, currency, order_value)
        VALUES ('csv-only', '2026-01-01', 'USD', 10)
      `,
    ).run();
    const run = await createManualReconciliationRun(env);

    await executeReconciliationRun(env, { kind: "reconciliation", runId: run!.id });

    expect(
      db.sqlite.prepare("SELECT status FROM etsy_reconciliation_runs WHERE id=?").get(run!.id),
    ).toEqual({ status: "completed" });
    expect(
      db.sqlite.prepare(
        `
          SELECT issue_type, severity, reason_code, source_record_id
          FROM etsy_reconciliation_issues
          WHERE reconciliation_run_id=? ORDER BY source_record_id
        `,
      ).all(run!.id),
    ).toEqual([
      {
        issue_type: "missing_in_csv",
        severity: "error",
        reason_code: "MISSING_IN_CSV",
        source_record_id: "api-only",
      },
      {
        issue_type: "missing_in_api",
        severity: "error",
        reason_code: "MISSING_IN_API",
        source_record_id: "csv-only",
      },
    ]);
    expect(
      db.sqlite.prepare("SELECT shadow_json FROM etsy_reconciliation_runs WHERE id=?").get(run!.id),
    ).toEqual({ shadow_json: JSON.stringify({ status: "no_legacy_generation" }) });
  });
});

describe("reconciliation severity rules", () => {
  it("keeps tolerance differences as warnings and parent mismatches as critical", () => {
    expect(severityForMetric({ status: "WARNING" } as never)).toBe("warning");
    expect(reasonCodeForMetric({ status: "WARNING" } as never)).toBe("WITHIN_TOLERANCE");
    expect(severityForIssue("parent_mismatch")).toBe("critical");
    expect(reasonCodeForIssue("parent_mismatch")).toBe("PARENT_ID_MISMATCH");
  });

  it("classifies only differences within 0.02 USD as rounding warnings", () => {
    const row = {
      id: "payment",
      date: "2026-01-01",
      api_currency: "USD",
      csv_currency: "USD",
    };
    expect(financialIssue("payments", row, "gross", 10, 9.99)?.reasonCode)
      .toBe("ROUNDING_WITHIN_TOLERANCE");
    expect(financialIssue("payments", row, "gross", 10, 9.97)?.reasonCode)
      .toBe("AMOUNT_MISMATCH");
    expect(financialIssue("payments", { ...row, api_currency: "EUR" }, "gross", 10, 10)?.status)
      .toBe("BLOCKING");
  });
});

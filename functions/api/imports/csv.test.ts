import { describe, expect, it } from "vitest";
import { onRequestPost } from "./csv";
import { onRequestGet as getImportStatus } from "./[id]";
import { DeferredGate, GatedTestD1, TestD1, collectWaitUntil } from "./_testD1";

const PAYMENTS_HEADERS =
  "Payment ID,Buyer Username,Buyer Name,Order ID,Gross Amount,Fees,Net Amount,Posted Gross,Posted Fees,Posted Net,Adjusted Gross,Adjusted Fees,Adjusted Net,Currency,Listing Amount,Listing Currency,Exchange Rate,VAT Amount,Gift Card Applied?,Status,Funds Available,Order Date,Buyer,Order Type,Payment Type,Refund Amount";

function paymentsCsv(rows: string[]): string {
  return [PAYMENTS_HEADERS, ...rows].join("\n");
}

const PAYMENTS_CSV = paymentsCsv([
  "PAY-1,buyer1,Buyer One,ORD-1,100,10,90,100,10,90,100,10,90,USD,100,USD,1,0,No,Paid,Available,01/15/2026,Buyer One,Online,Card,0",
  "PAY-2,buyer2,Buyer Two,ORD-2,200,20,180,200,20,180,200,20,180,USD,200,USD,1,0,No,Paid,Available,02/20/2026,Buyer Two,Online,Card,0",
]);

const ORDER_ITEMS_MISSING_PARENT_CSV = [
  "Transaction ID,Order ID,Listing ID,Sale Date,Item Name,Buyer,Quantity,Price,Item Total,Currency,Date Paid",
  "TXN-1,ORD-999,LIST-1,01/10/2026,Widget,Buyer One,1,50,50,USD,01/12/2026",
].join("\n");

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

function buildRequest(file: File, declaredType?: string): Request {
  const formData = new FormData();
  formData.append("file", file);
  if (declaredType) {
    formData.append("declaredType", declaredType);
  }
  return new Request("http://localhost/api/imports/csv", { method: "POST", body: formData });
}

describe("CSV import async flow", () => {
  it("returns 202 immediately, without final counts, then completes with counts and date range", async () => {
    const db = new TestD1();
    const { waitUntil, flush } = collectWaitUntil();

    const response = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: db as never },
      waitUntil,
    });

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("pending");
    expect(typeof body.importId).toBe("number");
    // The response is sent before the background job runs, so final stats
    // are not known synchronously.
    expect(body.insertedCount).toBeUndefined();

    await flush();

    const finalResponse = await getImportStatus({
      env: { DB: db as never },
      params: { id: String(body.importId) },
    });
    const finalBody = await finalResponse.json();

    expect(finalBody.status).toBe("completed");
    expect(finalBody.insertedCount).toBe(2);
    expect(finalBody.skippedCount).toBe(0);
    expect(finalBody.errorCount).toBe(0);
    expect(finalBody.dateRangeStart).toBe("2026-01-15");
    expect(finalBody.dateRangeEnd).toBe("2026-02-20");
  });

  it("stays in a non-terminal stage while the write is delayed, then completes once unblocked", async () => {
    const db = new TestD1();
    const gate = new DeferredGate();
    gate.hold();
    const gatedDb = new GatedTestD1(db, gate);
    const { waitUntil, flush } = collectWaitUntil();

    const response = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: gatedDb as never },
      waitUntil,
    });
    const body = await response.json();

    const stillRunning = await getImportStatus({
      env: { DB: gatedDb as never },
      params: { id: String(body.importId) },
    });
    const stillRunningBody = await stillRunning.json();
    expect(stillRunningBody.status).toBe("importing");

    gate.release();
    await flush();

    const done = await getImportStatus({
      env: { DB: gatedDb as never },
      params: { id: String(body.importId) },
    });
    expect((await done.json()).status).toBe("completed");
  });

  it("marks the import failed with the exact error when parent orders are missing", async () => {
    const db = new TestD1();
    const { waitUntil, flush } = collectWaitUntil();

    const response = await onRequestPost({
      request: buildRequest(
        csvFile("order-items.csv", ORDER_ITEMS_MISSING_PARENT_CSV),
        "sold_order_items",
      ),
      env: { DB: db as never },
      waitUntil,
    });
    const body = await response.json();
    expect(response.status).toBe(202);

    await flush();

    const statusResponse = await getImportStatus({
      env: { DB: db as never },
      params: { id: String(body.importId) },
    });
    const statusBody = await statusResponse.json();

    expect(statusBody.status).toBe("failed");
    expect(statusBody.errorMessage).toBe(
      "Sold Order Items require matching Sold Orders. Import Sold Orders first.",
    );
  });

  it("rejects a second submission of the same file while the first is still processing", async () => {
    const db = new TestD1();
    const gate = new DeferredGate();
    gate.hold();
    const gatedDb = new GatedTestD1(db, gate);
    const { waitUntil, flush } = collectWaitUntil();

    const first = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: gatedDb as never },
      waitUntil,
    });
    expect(first.status).toBe(202);

    const second = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: gatedDb as never },
      waitUntil,
    });
    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.error).toBe("import_in_progress");

    gate.release();
    await flush();

    // Once the first import has completed, resubmitting the same file is
    // treated as a completed-duplicate, not an in-progress conflict.
    const third = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: gatedDb as never },
      waitUntil,
    });
    const thirdBody = await third.json();
    expect(thirdBody.duplicateFile).toBe(true);
  });

  it("skips a completed-duplicate file synchronously without starting a background job", async () => {
    const db = new TestD1();
    const { waitUntil, flush } = collectWaitUntil();

    const first = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: db as never },
      waitUntil,
    });
    await first.json();
    await flush();

    const second = await onRequestPost({
      request: buildRequest(csvFile("payments.csv", PAYMENTS_CSV), "direct_checkout_payments"),
      env: { DB: db as never },
      waitUntil,
    });
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.duplicateFile).toBe(true);
    expect(secondBody.status).toBe("duplicate_skipped");
    expect(secondBody.skippedCount).toBe(2);
  });

  it("still rejects an unrecognized CSV synchronously before creating any import row", async () => {
    const db = new TestD1();
    const { waitUntil } = collectWaitUntil();

    const response = await onRequestPost({
      request: buildRequest(csvFile("mystery.csv", "Foo,Bar\n1,2"), undefined),
      env: { DB: db as never },
      waitUntil,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("unknown_csv_type");
    expect(body.importId).toBeUndefined();
  });

  it("returns 404 for an unknown import id", async () => {
    const db = new TestD1();

    const response = await getImportStatus({ env: { DB: db as never }, params: { id: "999999" } });
    expect(response.status).toBe(404);
  });
});

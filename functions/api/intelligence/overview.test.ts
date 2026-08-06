import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";
import { onRequestGet } from "./overview";
import type { IntelligenceOverviewResponse } from "../../../src/data/types/intelligence";

/**
 * End-to-end shape of the dashboard endpoint's ledger metrics.
 *
 * The contract the UI depends on is that the on-screen chain adds up:
 *   netRevenue + adSpend + otherEtsyCosts === trueNet
 * If that ever drifts, the dashboard shows an arithmetic error to the owner.
 */

const SHOP_ID = "shop-1";
const SYNCED_AT = "2026-05-20T00:00:00Z";

function ts(day: number, hour = 12): number {
  return Math.floor(Date.UTC(2026, 4, day, hour) / 1000);
}

function seedShop(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `INSERT INTO etsy_api_shops (shop_id, user_id, shop_name, synced_at)
       VALUES (?, 'user-1', 'Test Shop', ?)`,
    )
    .run(SHOP_ID, SYNCED_AT);
}

/**
 * One sale: USD 10.00 grandtotal settled as 400.00 TRY, so the day's rate is
 * 40 TRY per USD. Fees 40.00 TRY (USD 1.00), net 360.00 TRY (USD 9.00).
 */
function seedSale(db: FullSchemaTestD1, id: string, day: number): void {
  db.sqlite
    .prepare(
      `INSERT INTO etsy_api_receipts (
         receipt_id, shop_id, buyer_hash, status, create_timestamp,
         total_price_amount, total_price_divisor, total_price_currency,
         discount_amt_amount, discount_amt_divisor, discount_amt_currency,
         grandtotal_amount, grandtotal_divisor, grandtotal_currency, synced_at
       ) VALUES (?, ?, 'buyer', 'Completed', ?, 1000, 100, 'USD', 0, 100, 'USD', 1000, 100, 'USD', ?)`,
    )
    .run(`rcpt-${id}`, SHOP_ID, ts(day), SYNCED_AT);

  db.sqlite
    .prepare(
      `INSERT INTO etsy_api_transactions (
         transaction_id, receipt_id, listing_id, title, quantity,
         price_amount, price_divisor, price_currency, synced_at
       ) VALUES (?, ?, 'listing-1', 'Pattern', 1, 1000, 100, 'USD', ?)`,
    )
    .run(`txn-${id}`, `rcpt-${id}`, SYNCED_AT);

  db.sqlite
    .prepare(
      `INSERT INTO etsy_api_payments (
         payment_id, shop_id, receipt_id, status, payment_method,
         amount_gross, amount_gross_divisor, amount_gross_currency,
         amount_fees, amount_fees_divisor, amount_fees_currency,
         amount_net, amount_net_divisor, amount_net_currency,
         create_timestamp, synced_at, currency, shop_currency, buyer_currency
       ) VALUES (?, ?, ?, 'SETTLED', 'cc', 40000, 100, 'USD', 4000, 100, 'USD', 36000, 100, 'USD', ?, ?, 'TRY', 'USD', 'USD')`,
    )
    .run(`pay-${id}`, SHOP_ID, `rcpt-${id}`, ts(day), SYNCED_AT);
}

function seedLedger(
  db: FullSchemaTestD1,
  id: string,
  day: number,
  ledgerType: string,
  amountMinor: number,
): void {
  db.sqlite
    .prepare(
      `INSERT INTO etsy_api_ledger_entries (
         entry_id, shop_id, sequence_number, amount, currency, balance,
         create_timestamp, ledger_type, synced_at
       ) VALUES (?, ?, 1, ?, 'TRY', 0, ?, ?, ?)`,
    )
    .run(`led-${id}`, SHOP_ID, amountMinor, ts(day), ledgerType, SYNCED_AT);
}

async function loadOverview(db: FullSchemaTestD1): Promise<IntelligenceOverviewResponse> {
  const response = await onRequestGet({
    request: new Request("https://example.com/api/intelligence/overview?month=2026-05"),
    env: { DB: db },
  });
  return (await response.json()) as IntelligenceOverviewResponse;
}

describe("intelligence overview — Etsy account costs", () => {
  it("publishes ad spend, other costs and True Net, and the chain adds up", async () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    seedSale(db, "a", 10);

    // The ledger side of the same sale, plus costs the payment rows never see.
    seedLedger(db, "gross", 10, "PAYMENT_GROSS", 40000); // +$10.00
    seedLedger(db, "fee", 10, "PAYMENT_PROCESSING_FEE", -4000); // -$1.00
    seedLedger(db, "ads", 12, "prolist", -8000); // -$2.00, a day with no sale
    seedLedger(db, "commission", 10, "transaction", -2000); // -$0.50
    seedLedger(db, "bank", 15, "DISBURSE2", -20000); // a move, not a cost

    const body = await loadOverview(db);

    expect(body.metrics.netRevenue.current).toBeCloseTo(9, 6);
    expect(body.metrics.adSpend.current).toBeCloseTo(-2, 6);
    expect(body.metrics.otherEtsyCosts.current).toBeCloseTo(-0.5, 6);
    expect(body.metrics.trueNet.current).toBeCloseTo(6.5, 6);

    // The contract the dashboard renders.
    expect(
      body.metrics.netRevenue.current! +
        body.metrics.adSpend.current! +
        body.metrics.otherEtsyCosts.current!,
    ).toBeCloseTo(body.metrics.trueNet.current!, 8);

    // The bank disbursement must not read as a cost.
    expect(body.ledger.categoryUsd.disbursement).toBeCloseTo(-5, 6);
    expect(body.ledger.unconvertibleCount).toBe(0);
    expect(body.ledger.otherCategoryCount).toBe(0);
  });

  it("leaves Net Revenue untouched, so Etsy's own screen still reconciles", async () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    seedSale(db, "a", 10);
    seedLedger(db, "gross", 10, "PAYMENT_GROSS", 40000);
    seedLedger(db, "fee", 10, "PAYMENT_PROCESSING_FEE", -4000);
    seedLedger(db, "ads", 10, "prolist", -8000);

    const body = await loadOverview(db);

    expect(body.metrics.grossSales.current).toBeCloseTo(10, 6);
    expect(body.metrics.etsyFees.current).toBeCloseTo(1, 6);
    expect(body.metrics.netRevenue.current).toBeCloseTo(9, 6);
    expect(body.metrics.netRevenue.basis).toBe("after_etsy_fees_converted_per_payment_row");
    expect(body.metrics.trueNet.source).toBe("etsy_ledger");
  });

  it("marks all three unavailable when a ledger row has no usable rate", async () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    seedSale(db, "a", 10);
    // Dated before the first payment, so no rate can be carried forward to it.
    seedLedger(db, "early", 1, "prolist", -8000);
    seedLedger(db, "ads", 12, "prolist", -8000);

    const body = await loadOverview(db);

    expect(body.metrics.adSpend.current).toBeNull();
    expect(body.metrics.otherEtsyCosts.current).toBeNull();
    expect(body.metrics.trueNet.current).toBeNull();
    expect(body.metrics.netRevenue.current).toBeCloseTo(9, 6);
    expect(
      body.warnings.some((warning) => warning.includes("no usable exchange rate")),
    ).toBe(true);
  });

  it("warns when Etsy ships a fee type the dashboard does not classify", async () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    seedSale(db, "a", 10);
    seedLedger(db, "gross", 10, "PAYMENT_GROSS", 40000);
    seedLedger(db, "mystery", 11, "a_type_etsy_has_not_shipped_yet", -4000);

    const body = await loadOverview(db);

    expect(body.ledger.otherCategoryCount).toBe(1);
    expect(body.ledger.categoryUsd.other).toBeCloseTo(-1, 6);
    // Still counted in True Net — unclassified is not the same as ignored.
    expect(body.metrics.trueNet.current).toBeCloseTo(9, 6);
    expect(
      body.warnings.some((warning) => warning.includes("does not classify yet")),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../../../workers/etsy-sync/src/test/testD1";

/**
 * v_ledger_canonical / v_ledger_daily_rate (migrations 0028 -> 0030).
 *
 * The view is deliberately raw: entry date, category and the TRY amount. USD
 * conversion happens in `functions/api/intelligence/_ledger.ts` and is covered
 * by `_ledger.test.ts` — resolving the carried-forward rate per row in SQL blew
 * D1's CPU limit (see migration 0030).
 */

const SHOP_ID = "shop-1";
const SYNCED_AT = "2026-05-15T00:00:00Z";

function ts(year: number, monthIndex: number, day: number): number {
  return Math.floor(Date.UTC(year, monthIndex, day, 12) / 1000);
}

function seedShop(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_shops (shop_id, user_id, shop_name, synced_at)
        VALUES (?, 'user-1', 'Test Shop', ?)
      `,
    )
    .run(SHOP_ID, SYNCED_AT);
}

/**
 * A settled payment, which is what a day's TRY->USD rate is derived from.
 * `grossMinor / grandTotalMinor` is the rate the view reports for that day.
 */
function insertPayment(
  db: FullSchemaTestD1,
  paymentId: string,
  receiptId: string,
  createTs: number,
  opts: { grossMinor?: number; grandTotalMinor?: number; divisor?: number } = {},
): void {
  const divisor = opts.divisor ?? 100;

  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, buyer_hash, status, create_timestamp,
          total_price_amount, total_price_divisor, total_price_currency,
          grandtotal_amount, grandtotal_divisor, grandtotal_currency, synced_at
        ) VALUES (?, ?, 'buyer', 'Completed', ?, 940, 100, 'USD', ?, 100, 'USD', ?)
      `,
    )
    .run(receiptId, SHOP_ID, createTs, opts.grandTotalMinor ?? 1000, SYNCED_AT);

  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_payments (
          payment_id, shop_id, receipt_id, status, payment_method,
          amount_gross, amount_gross_divisor, amount_gross_currency,
          amount_fees, amount_fees_divisor, amount_fees_currency,
          amount_net, amount_net_divisor, amount_net_currency,
          create_timestamp, synced_at, currency, shop_currency, buyer_currency
        ) VALUES (?, ?, ?, 'SETTLED', 'cc', ?, ?, 'USD', 1000, ?, 'USD', ?, ?, 'USD', ?, ?, 'TRY', 'USD', 'USD')
      `,
    )
    .run(
      paymentId,
      SHOP_ID,
      receiptId,
      opts.grossMinor ?? 40000,
      divisor,
      divisor,
      (opts.grossMinor ?? 40000) - 1000,
      divisor,
      createTs,
      SYNCED_AT,
    );
}

function insertLedger(
  db: FullSchemaTestD1,
  entryId: string,
  createTs: number,
  ledgerType: string,
  amountMinor: number,
  opts: { currency?: string; balanceMinor?: number } = {},
): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_ledger_entries (
          entry_id, shop_id, amount, currency, balance,
          create_timestamp, ledger_type, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      entryId,
      SHOP_ID,
      amountMinor,
      opts.currency ?? "TRY",
      opts.balanceMinor ?? 0,
      createTs,
      ledgerType,
      SYNCED_AT,
    );
}

type LedgerRow = {
  category: string;
  amountTry: number | null;
  entryDate: string;
  entryCurrency: string | null;
};

function loadEntry(db: FullSchemaTestD1, entryId: string): LedgerRow | undefined {
  return db.sqlite
    .prepare(
      `
        SELECT category, amount_try AS amountTry, entry_date AS entryDate,
               entry_currency AS entryCurrency
        FROM v_ledger_canonical WHERE entry_id = ?
      `,
    )
    .get<LedgerRow>(entryId);
}

describe("v_ledger_canonical (0030)", () => {
  it("1. maps every production ledger type, and unknown types fall to 'other'", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    const day = ts(2026, 4, 10);

    const cases: Array<[string, string]> = [
      ["PAYMENT_GROSS", "sales_gross"],
      ["REFUND_GROSS", "refund"],
      ["sales_tax", "tax_remitted"],
      ["vat_tax_ep", "tax_remitted"],
      ["VAT_REFUND_EP", "tax_remitted"],
      ["PAYMENT_PROCESSING_FEE", "fee_processing"],
      ["REFUND_PROCESSING_FEE", "fee_processing"],
      ["transaction", "fee_transaction"],
      ["transaction_refund", "fee_transaction"],
      ["regulatory_operating_fee", "fee_regulatory"],
      ["regulatory_operating_fee_refund", "fee_regulatory"],
      ["vat_seller_services", "fee_vat"],
      ["vat_seller_services_refund", "fee_vat"],
      ["vat_on_processing_fees", "fee_vat"],
      ["renew_sold_auto", "fee_listing"],
      ["renew_sold_auto_refund", "fee_listing"],
      ["renew_sold", "fee_listing"],
      ["listing", "fee_listing"],
      ["listing_refund", "fee_listing"],
      ["auto_renew_expired", "fee_listing"],
      ["renew", "fee_listing"],
      ["renew_expired", "fee_listing"],
      ["prolist", "ads"],
      ["prolist_refund", "ads"],
      ["offsite_ads_fee", "ads"],
      ["seller_credit", "credit"],
      ["SELLER_DRIVEN_TRAFFIC_CREDIT", "credit"],
      ["seller_onboarding_fee", "onboarding"],
      ["seller_onboarding_fee_payment", "onboarding"],
      ["DISBURSE2", "disbursement"],
      ["billing_payment", "funding"],
      ["a_type_etsy_has_not_shipped_yet", "other"],
    ];

    cases.forEach(([ledgerType], index) => {
      insertLedger(db, `entry-${index}`, day, ledgerType, -100);
    });

    cases.forEach(([ledgerType, expected], index) => {
      expect(loadEntry(db, `entry-${index}`)?.category, ledgerType).toBe(expected);
    });
  });

  it("2. exposes the raw TRY amount and date, with no conversion in SQL", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    insertLedger(db, "ads-1", ts(2026, 4, 10), "prolist", -18000);

    const row = loadEntry(db, "ads-1")!;
    expect(row.amountTry).toBeCloseTo(-180, 8);
    expect(row.entryDate).toBe("2026-05-10");
    expect(row.entryCurrency).toBe("TRY");
  });

  it("3. v_ledger_daily_rate divides settlement gross by the USD grandtotal", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    // 400.00 TRY settled against a 10.00 USD grandtotal -> 40 TRY per USD.
    insertPayment(db, "pay-1", "rcpt-1", ts(2026, 4, 10), {
      grossMinor: 40000,
      grandTotalMinor: 1000,
    });

    const rate = db.sqlite
      .prepare(`SELECT rate_date AS rateDate, settlement_per_usd AS rate FROM v_ledger_daily_rate`)
      .all() as Array<{ rateDate: string; rate: number }>;

    expect(rate).toHaveLength(1);
    expect(rate[0].rateDate).toBe("2026-05-10");
    expect(rate[0].rate).toBeCloseTo(40, 8);
  });

  it("4. a payment with a wrong divisor is excluded from the day's rate", () => {
    // Production payment 204718752729 (buyer currency IDR) carries divisor 1
    // instead of 100. Left in, it would skew its day's rate by 100x.
    const db = new FullSchemaTestD1();
    seedShop(db);
    const day = ts(2026, 4, 10);
    insertPayment(db, "pay-good", "rcpt-good", day, {
      grossMinor: 40000,
      grandTotalMinor: 1000,
    });
    insertPayment(db, "pay-idr", "rcpt-idr", day, {
      grossMinor: 40000,
      grandTotalMinor: 1000,
      divisor: 1,
    });

    const rate = db.sqlite
      .prepare(`SELECT settlement_per_usd AS rate FROM v_ledger_daily_rate`)
      .get<{ rate: number }>();

    expect(rate?.rate).toBeCloseTo(40, 8);
  });

  it("5. summed movement matches the balance the period moved through", () => {
    const db = new FullSchemaTestD1();
    seedShop(db);
    const day = ts(2026, 4, 10);

    // Opening 100.00 TRY, then +400.00, -40.00, -80.00 on the 10th.
    insertLedger(db, "open-1", ts(2026, 4, 9), "PAYMENT_GROSS", 10000, { balanceMinor: 10000 });
    insertLedger(db, "gross-1", day, "PAYMENT_GROSS", 40000, { balanceMinor: 50000 });
    insertLedger(db, "fee-1", day, "PAYMENT_PROCESSING_FEE", -4000, { balanceMinor: 46000 });
    insertLedger(db, "ads-1", day, "prolist", -8000, { balanceMinor: 38000 });

    const movement = db.sqlite
      .prepare(`SELECT SUM(amount_try) AS movement FROM v_ledger_canonical WHERE entry_date = ?`)
      .get<{ movement: number }>("2026-05-10");

    expect(movement?.movement).toBeCloseTo(380 - 100, 8);
  });

  it("6. exposes sequence_number, without which the balance chain cannot be ordered", () => {
    // Entries routinely share a create_timestamp; the running balance is only
    // meaningful ordered by (create_timestamp, sequence_number). A check that
    // broke ties on entry_id reported false drift on production (0031).
    const db = new FullSchemaTestD1();
    seedShop(db);
    const day = ts(2026, 4, 10);

    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_ledger_entries (
            entry_id, shop_id, sequence_number, amount, currency, balance,
            create_timestamp, ledger_type, synced_at
          ) VALUES (?, ?, ?, ?, 'TRY', ?, ?, ?, ?)
        `,
      )
      .run("z-last", SHOP_ID, 2, -4000, 46000, day, "PAYMENT_PROCESSING_FEE", SYNCED_AT);
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_ledger_entries (
            entry_id, shop_id, sequence_number, amount, currency, balance,
            create_timestamp, ledger_type, synced_at
          ) VALUES (?, ?, ?, ?, 'TRY', ?, ?, ?, ?)
        `,
      )
      .run("a-first", SHOP_ID, 1, 40000, 50000, day, "PAYMENT_GROSS", SYNCED_AT);

    const ordered = db.sqlite
      .prepare(
        `
          SELECT entry_id AS entryId, balance_try AS balanceTry
          FROM v_ledger_canonical
          ORDER BY create_timestamp, sequence_number
        `,
      )
      .all() as Array<{ entryId: string; balanceTry: number }>;

    // entry_id order would put "a-first" first by luck here, but the closing
    // balance must come from the highest sequence_number, not the last id.
    expect(ordered.map((row) => row.entryId)).toEqual(["a-first", "z-last"]);
    expect(ordered[ordered.length - 1].balanceTry).toBeCloseTo(460, 8);
  });
});

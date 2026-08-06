import { describe, expect, it } from "vitest";
import { FullSchemaTestD1 } from "../test/testD1";
import type { AdapterPage, SyncTask } from "../engine/types";
import type { Env } from "../types";
import { ListingsAdapter } from "./listings";
import { ListingInventoryAdapter } from "./inventory";
import { ListingFilesAdapter } from "./listingFiles";
import { PaymentsAdapter } from "./payments";
import { LedgerEntriesAdapter } from "./ledger";
import { ReviewsAdapter } from "./reviews";
import { ShopSectionsAdapter } from "./shop";
import { SnapshotsAdapter } from "./snapshots";

function seed(db: FullSchemaTestD1): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO etsy_api_shops (
          shop_id,user_id,shop_name,title,announcement,currency_code,synced_at
        ) VALUES ('shop','user','Shop','','','USD',CURRENT_TIMESTAMP)
      `,
    )
    .run();
}

function task(resource: string): SyncTask {
  return {
    id: `task-${resource}`,
    runId: "run",
    shopId: "shop",
    resource,
    adapterVersion: 1,
    strategy: "offset_paged",
    idempotencyKey: `run:${resource}`,
    status: "running",
    cursor: {},
    segmentStart: null,
    segmentEnd: null,
    pageOffset: 0,
    pageSize: 100,
    expectedCount: null,
    attemptCount: 1,
    maxAttempts: 12,
    leaseToken: "lease",
    isPeriodRun: false,
    periodFromTs: null,
    periodToTs: null,
  };
}

function page<T>(records: T[]): AdapterPage<T> {
  return {
    records,
    responseCount: records.length,
    nextCursor: null,
    pageKey: "page",
    qpsLimit: 10,
    qpsRemaining: 9,
    qpdLimit: 10_000,
    qpdRemaining: 9_999,
  };
}

function context(db: FullSchemaTestD1) {
  const env = { DB: db } as unknown as Env;
  return { db, env, now: new Date("2026-07-26T00:00:00Z") };
}

describe("generic Etsy resource adapters", () => {
  it("plans reviews as a splittable Etsy time window", async () => {
    const db = new FullSchemaTestD1();
    const ctx = context(db);
    const plans = await new ReviewsAdapter().planInitial(ctx, "run", "shop");
    expect(plans).toEqual([
      expect.objectContaining({
        resource: "reviews",
        strategy: "time_windowed",
        segmentStart: 946_684_800,
        segmentEnd: Math.floor(ctx.now.getTime() / 1000),
        pageOffset: 0,
        pageSize: 100,
      }),
    ]);
  });

  it("persists shop sections and replaces listing children", async () => {
    const db = new FullSchemaTestD1();
    seed(db);
    const ctx = context(db);
    await new ShopSectionsAdapter().persistPage(
      ctx,
      task("shop_sections"),
      page([{ shop_section_id: 7, title: "Digital", rank: 1 }]),
    );
    const listings = new ListingsAdapter();
    const listingPage = page([
      {
        listing_id: 10,
        shop_id: 0,
        title: "Pattern",
        description: "PDF",
        state: "active",
        url: "https://example.test/10",
        quantity: 5,
        price: { amount: 500, divisor: 100, currency_code: "USD" },
        images: [{ listing_image_id: 100, rank: 1, alt_text: "front" }],
        inventory: { products: [] },
      },
    ]);
    // Etsy's listing payload shop_id is authoritative; use the seeded shop.
    listingPage.records[0].shop_id = "shop" as unknown as number;
    await listings.persistPage(ctx, task("listings"), listingPage);
    await new ListingInventoryAdapter().persistPage(
      ctx,
      task("listing_inventory"),
      page([{
        listing_id: 10,
        inventory: {
          products: [{ product_id: 1 }],
          price_on_property: [200],
          quantity_on_property: [200],
          sku_on_property: [],
        },
      }]),
    );
    listingPage.records[0].images = [{ listing_image_id: 101, rank: 1 }];
    delete listingPage.records[0].inventory;
    await listings.persistPage(ctx, task("listings"), listingPage);

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_shop_sections").get(),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_listings").get(),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT listing_image_id FROM etsy_api_listing_images").get(),
    ).toEqual({ listing_image_id: "101" });
    expect(
      db.sqlite
        .prepare(
          "SELECT products_json,price_on_property_json FROM etsy_api_listing_inventory",
        )
        .get(),
    ).toEqual({
      products_json: '[{"product_id":1}]',
      price_on_property_json: "[200]",
    });
  });

  it("replaces listing files and receipt payment snapshots idempotently", async () => {
    const db = new FullSchemaTestD1();
    seed(db);
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_listings (
            listing_id,shop_id,title,description,state,url,content_hash,synced_at
          ) VALUES ('10','shop','','','active','','hash',CURRENT_TIMESTAMP)
        `,
      )
      .run();
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_receipts (
            receipt_id,shop_id,status,synced_at
          ) VALUES ('20','shop','paid',CURRENT_TIMESTAMP)
        `,
      )
      .run();
    const ctx = context(db);
    await new ListingFilesAdapter().persistPage(
      ctx,
      task("listing_files"),
      page([{ listingId: "10", files: [{ listing_file_id: 1000, filename: "a.pdf" }] }]),
    );
    const paymentPage = page([
      {
        receiptId: "20",
        payments: [{
          payment_id: 30,
          receipt_id: 20,
          shop_id: 1,
          status: "settled",
          currency: "USD",
          amount_gross: { amount: 500, divisor: 100, currency_code: "USD" },
          payment_adjustments: [{
            payment_adjustment_id: 40,
            payment_id: 30,
            status: "SUCCESS",
            payment_adjustment_items: [{
              payment_adjustment_id: 40,
              payment_adjustment_item_id: 41,
              amount: 100,
            }],
          }],
        }],
      },
    ]);
    const payments = new PaymentsAdapter();
    await payments.persistPage(ctx, task("payments"), paymentPage);
    await payments.persistPage(ctx, task("payments"), paymentPage);

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_listing_files").get(),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_payments").get(),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_payment_adjustments").get(),
    ).toEqual({ count: 1 });
  });

  it("persists ledger entries, reviews and local snapshots", async () => {
    const db = new FullSchemaTestD1();
    seed(db);
    db.sqlite
      .prepare(
        `
          INSERT INTO etsy_api_listings (
            listing_id,shop_id,title,description,state,url,quantity,
            num_favorers,content_hash,synced_at
          ) VALUES ('10','shop','','','active','',2,3,'hash',CURRENT_TIMESTAMP)
        `,
      )
      .run();
    const ctx = context(db);
    await new LedgerEntriesAdapter().persistPage(
      ctx,
      task("ledger_entries"),
      page([{ entry_id: 50, amount: 500, currency: "USD" }]),
    );
    await new ReviewsAdapter().persistPage(
      ctx,
      task("reviews"),
      page([{
        reviewKey: "review",
        listing_id: 10,
        rating: 5,
        review: "Great",
        created_timestamp: 1_700_000_000,
      }]),
    );
    await new SnapshotsAdapter().persistPage(ctx, task("snapshots"));

    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_ledger_entries").get(),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_api_reviews").get(),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM etsy_listing_metric_snapshots").get(),
    ).toEqual({ count: 1 });
  });
});

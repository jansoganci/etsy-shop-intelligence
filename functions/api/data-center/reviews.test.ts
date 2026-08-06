import { describe, expect, it } from "vitest";
import { TestD1 } from "../imports/_testD1";
import { onRequestGet } from "./reviews";

function seedReviews(db: TestD1) {
  db.sqlite.exec(`
    INSERT INTO etsy_connections (
      shop_id, etsy_user_id, shop_name, scopes_json,
      access_token_ciphertext, access_token_iv,
      refresh_token_ciphertext, refresh_token_iv,
      access_token_expires_at, status
    ) VALUES (
      'shop-1', 'user-1', 'Knit Bliss', '[]',
      'cipher', 'iv', 'refresh', 'refresh-iv',
      '2099-01-01T00:00:00Z', 'connected'
    );

    INSERT INTO etsy_api_shops (
      shop_id, user_id, shop_name, synced_at
    ) VALUES ('shop-1', 'user-1', 'Knit Bliss', CURRENT_TIMESTAMP);

    INSERT INTO etsy_api_listings (
      listing_id, shop_id, title, description, state, url,
      tags_json, materials_json, content_hash, synced_at
    ) VALUES (
      'listing-1', 'shop-1', 'Blue Knit Pattern', 'Description',
      'active', 'https://example.test/listing-1', '[]', '[]',
      'hash', CURRENT_TIMESTAMP
    );

    INSERT INTO etsy_api_receipts (
      receipt_id, shop_id, buyer_hash, synced_at
    ) VALUES ('receipt-1', 'shop-1', 'private-buyer-hash', CURRENT_TIMESTAMP);

    INSERT INTO etsy_api_transactions (
      transaction_id, receipt_id, listing_id, title, quantity,
      variations_json, product_data_json, synced_at
    ) VALUES (
      'transaction-1', 'receipt-1', 'listing-1', 'Blue Knit Pattern',
      1, '[]', '[]', CURRENT_TIMESTAMP
    );

    INSERT INTO etsy_api_reviews (
      review_key, shop_id, transaction_id, listing_id, rating,
      review_text, language, create_timestamp, update_timestamp, synced_at
    ) VALUES
      (
        'review-1', 'shop-1', 'transaction-1', 'listing-1', 5,
        'Wonderful pattern', 'en', 1767225600, 1767225600, CURRENT_TIMESTAMP
      ),
      (
        'review-2', 'shop-1', NULL, 'listing-1', 3,
        'Good but difficult', 'en', 1767312000, 1767312000, CURRENT_TIMESTAMP
      );
  `);
}

describe("Data Center reviews endpoint", () => {
  it("returns real joined references, aggregates and no buyer PII", async () => {
    const db = new TestD1();
    seedReviews(db);

    const response = await onRequestGet({
      request: new Request(
        "https://example.test/api/data-center/reviews?q=Wonderful&rating=5",
      ),
      env: { DB: db as never },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      totalCount: 1,
      averageRating: 5,
    });
    expect(body.summary.distribution["5"]).toBe(1);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      reviewKey: "review-1",
      listingTitle: "Blue Knit Pattern",
      transactionId: "transaction-1",
      receiptId: "receipt-1",
    });
    expect(JSON.stringify(body)).not.toContain("private-buyer-hash");
    expect(body.capabilities).toEqual({
      buyerName: false,
      sellerResponse: false,
      responseStatus: false,
    });
  });

  it("returns a clear conflict when Etsy is not connected", async () => {
    const db = new TestD1();
    const response = await onRequestGet({
      request: new Request("https://example.test/api/data-center/reviews"),
      env: { DB: db as never },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: "etsy_not_connected",
    });
  });
});

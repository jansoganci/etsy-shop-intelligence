import { buyerHash, sha256 } from "./crypto";
import type {
  D1Database,
  Env,
  EtsyImage,
  EtsyListing,
  EtsyPayment,
  EtsyReceipt,
  EtsyShop,
  EtsyTransaction,
  Money,
  PaymentAdjustment,
  PaymentAdjustmentItem,
  ShopRefund,
  SyncResource,
} from "./types";

function textId(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function timestamp(value: number | undefined): number | null {
  return Number.isFinite(value) ? value! : null;
}

function moneyValues(value: Money | undefined): [number | null, number | null, string | null] {
  return [
    Number.isFinite(value?.amount) ? value!.amount! : null,
    Number.isFinite(value?.divisor) ? value!.divisor! : null,
    value?.currency_code ?? null,
  ];
}

function json(value: unknown, fallback: unknown = []): string {
  return JSON.stringify(value ?? fallback);
}

export async function upsertShop(db: D1Database, shop: EtsyShop): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO etsy_api_shops (
          shop_id, user_id, shop_name, title, announcement, currency_code,
          create_timestamp, update_timestamp, listing_active_count,
          digital_listing_count, review_count, review_average, url, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(shop_id) DO UPDATE SET
          user_id=excluded.user_id, shop_name=excluded.shop_name, title=excluded.title,
          announcement=excluded.announcement, currency_code=excluded.currency_code,
          create_timestamp=excluded.create_timestamp, update_timestamp=excluded.update_timestamp,
          listing_active_count=excluded.listing_active_count,
          digital_listing_count=excluded.digital_listing_count,
          review_count=excluded.review_count, review_average=excluded.review_average,
          url=excluded.url, synced_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      String(shop.shop_id),
      String(shop.user_id),
      shop.shop_name ?? "",
      shop.title ?? null,
      shop.announcement ?? null,
      shop.currency_code ?? null,
      timestamp(shop.created_timestamp ?? shop.create_date),
      timestamp(shop.updated_timestamp ?? shop.update_date),
      shop.listing_active_count ?? null,
      shop.digital_listing_count ?? null,
      shop.review_count ?? null,
      shop.review_average ?? null,
      shop.url ?? null,
    )
    .run();
}

export async function upsertListing(
  db: D1Database,
  listing: EtsyListing,
  knownContentHash?: string | null,
): Promise<"inserted" | "updated" | "unchanged"> {
  const listingId = String(listing.listing_id);
  const images = listing.images ?? listing.Images ?? [];
  const videos = listing.videos ?? listing.Videos ?? [];
  const inventory = listing.inventory ?? listing.Inventory;
  const state = ["active", "inactive", "sold_out", "draft", "expired"].includes(
    listing.state ?? "",
  )
    ? listing.state!
    : "inactive";
  const contentHash = await sha256(
    JSON.stringify({
      title: listing.title ?? "",
      description: listing.description ?? "",
      state,
      quantity: listing.quantity ?? 0,
      price: listing.price ?? null,
      tags: listing.tags ?? [],
      images: images.map((image) => [image.listing_image_id, image.alt_text, image.rank]),
    }),
  );
  const existing =
    knownContentHash === undefined
      ? await db
          .prepare("SELECT content_hash FROM etsy_api_listings WHERE listing_id = ?")
          .bind(listingId)
          .first<{ content_hash: string }>()
      : knownContentHash === null
        ? null
        : { content_hash: knownContentHash };
  const price = moneyValues(listing.price);
  const statements = [
    db
      .prepare(
        `
          INSERT INTO etsy_api_listings (
            listing_id, shop_id, title, description, state, url, quantity,
            price_amount, price_divisor, price_currency, taxonomy_id, shop_section_id,
            listing_type, tags_json, materials_json, num_favorers,
            is_customizable, is_personalizable, personalization_json,
            creation_timestamp, original_creation_timestamp, ending_timestamp,
            last_modified_timestamp, state_timestamp, content_hash, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(listing_id) DO UPDATE SET
            shop_id=excluded.shop_id, title=excluded.title, description=excluded.description,
            state=excluded.state, url=excluded.url, quantity=excluded.quantity,
            price_amount=excluded.price_amount, price_divisor=excluded.price_divisor,
            price_currency=excluded.price_currency, taxonomy_id=excluded.taxonomy_id,
            shop_section_id=excluded.shop_section_id, listing_type=excluded.listing_type,
            tags_json=excluded.tags_json, materials_json=excluded.materials_json,
            num_favorers=excluded.num_favorers, is_customizable=excluded.is_customizable,
            is_personalizable=excluded.is_personalizable,
            personalization_json=excluded.personalization_json,
            creation_timestamp=excluded.creation_timestamp,
            original_creation_timestamp=excluded.original_creation_timestamp,
            ending_timestamp=excluded.ending_timestamp,
            last_modified_timestamp=excluded.last_modified_timestamp,
            state_timestamp=excluded.state_timestamp, content_hash=excluded.content_hash,
            synced_at=CURRENT_TIMESTAMP
        `,
      )
      .bind(
        listingId,
        String(listing.shop_id),
        listing.title ?? "",
        listing.description ?? "",
        state,
        listing.url ?? "",
        listing.quantity ?? null,
        ...price,
        textId(listing.taxonomy_id),
        textId(listing.shop_section_id),
        listing.listing_type ?? null,
        json(listing.tags),
        json(listing.materials),
        listing.num_favorers ?? null,
        listing.is_customizable ? 1 : 0,
        listing.is_personalizable ? 1 : 0,
        listing.personalization === undefined ? null : json(listing.personalization, null),
        timestamp(listing.created_timestamp ?? listing.creation_timestamp),
        timestamp(listing.original_creation_timestamp),
        timestamp(listing.ending_timestamp),
        timestamp(listing.updated_timestamp ?? listing.last_modified_timestamp),
        timestamp(listing.state_timestamp),
        contentHash,
      ),
    db
      .prepare("DELETE FROM etsy_api_listing_images WHERE listing_id=?")
      .bind(listingId),
    db
      .prepare("DELETE FROM etsy_api_listing_videos WHERE listing_id=?")
      .bind(listingId),
  ];
  // Inventory has its own batch endpoint. Keep compatibility with older
  // listing payloads that still embed it, but never erase a separately synced
  // inventory snapshot when the field is absent.
  if (inventory !== undefined) {
    const value =
      inventory && typeof inventory === "object"
        ? inventory as Record<string, unknown>
        : {};
    statements.push(
      db
        .prepare(
          `
            INSERT INTO etsy_api_listing_inventory (
              listing_id, products_json, price_on_property_json,
              quantity_on_property_json, sku_on_property_json, synced_at
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(listing_id) DO UPDATE SET
              products_json=excluded.products_json,
              price_on_property_json=excluded.price_on_property_json,
              quantity_on_property_json=excluded.quantity_on_property_json,
              sku_on_property_json=excluded.sku_on_property_json,
              synced_at=CURRENT_TIMESTAMP
          `,
        )
        .bind(
          listingId,
          json(value.products, []),
          json(value.price_on_property, []),
          json(value.quantity_on_property, []),
          json(value.sku_on_property, []),
        ),
    );
  }
  await db.batch(statements);

  if (images.length > 0) {
    await upsertImages(db, listingId, images);
  }
  for (const video of videos) {
    const videoId = video.video_id ?? video.id;
    if (videoId === null || videoId === undefined) continue;
    await db
      .prepare(
        `
          INSERT INTO etsy_api_listing_videos (
            video_id, listing_id, height, width, thumbnail_url,
            video_url, video_state, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(video_id) DO UPDATE SET
            listing_id=excluded.listing_id, height=excluded.height,
            width=excluded.width, thumbnail_url=excluded.thumbnail_url,
            video_url=excluded.video_url, video_state=excluded.video_state,
            synced_at=CURRENT_TIMESTAMP
        `,
      )
      .bind(
        String(videoId),
        listingId,
        Number(video.height ?? 0),
        Number(video.width ?? 0),
        video.thumbnail_url ?? null,
        video.video_url ?? video.url ?? null,
        video.video_state ?? video.state ?? null,
      )
      .run();
  }
  await projectListing(db, listing, contentHash, images);
  if (!existing) return "inserted";
  return existing.content_hash === contentHash ? "unchanged" : "updated";
}

async function upsertImages(
  db: D1Database,
  listingId: string,
  images: EtsyImage[],
): Promise<void> {
  const statements = images.slice(0, 20).map((image) =>
    db
      .prepare(
        `
          INSERT INTO etsy_api_listing_images (
            listing_image_id, listing_id, rank, alt_text, width, height,
            url_75x75, url_170x135, url_570xN, url_fullxfull, color_hex, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(listing_image_id) DO UPDATE SET
            listing_id=excluded.listing_id, rank=excluded.rank, alt_text=excluded.alt_text,
            width=excluded.width, height=excluded.height, url_75x75=excluded.url_75x75,
            url_170x135=excluded.url_170x135, url_570xN=excluded.url_570xN,
            url_fullxfull=excluded.url_fullxfull, color_hex=excluded.color_hex,
            synced_at=CURRENT_TIMESTAMP
        `,
      )
      .bind(
        String(image.listing_image_id),
        listingId,
        image.rank ?? null,
        image.alt_text ?? null,
        image.width ?? null,
        image.height ?? null,
        image.url_75x75 ?? null,
        image.url_170x135 ?? null,
        image.url_570xN ?? null,
        image.url_fullxfull ?? null,
        image.hex_code ?? null,
      ),
  );
  if (statements.length) await db.batch(statements);
}

async function projectListing(
  db: D1Database,
  listing: EtsyListing,
  contentHash: string,
  images: EtsyImage[],
): Promise<void> {
  const listingId = String(listing.listing_id);
  const state = ["active", "inactive", "sold_out", "draft", "expired"].includes(
    listing.state ?? "",
  )
    ? listing.state!
    : "inactive";
  const current = await db
    .prepare(
      `
        SELECT l.current_version_id, v.content_hash
        FROM listings l LEFT JOIN listing_versions v ON v.id = l.current_version_id
        WHERE l.listing_id = ?
      `,
    )
    .bind(listingId)
    .first<{ current_version_id: number | null; content_hash: string | null }>();
  await db
    .prepare(
      `
        INSERT INTO listings (
          listing_id, url, status, source, first_seen_at, etsy_last_modified_at
        ) VALUES (?, ?, ?, 'etsy_api', ?, ?)
        ON CONFLICT(listing_id) DO UPDATE SET
          url=excluded.url, status=excluded.status, source='etsy_api',
          etsy_last_modified_at=excluded.etsy_last_modified_at,
          updated_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      listingId,
      listing.url ?? "",
      state,
      new Date((listing.original_creation_timestamp ?? Date.now() / 1000) * 1000).toISOString(),
      listing.last_modified_timestamp
        ? new Date(listing.last_modified_timestamp * 1000).toISOString()
        : null,
    )
    .run();
  if (current?.content_hash === contentHash) return;
  const price = listing.price?.divisor
    ? (listing.price.amount ?? 0) / listing.price.divisor
    : 0;
  const insert = await db
    .prepare(
      `
        INSERT INTO listing_versions (
          listing_id, effective_at, title, tags_json, description,
          image_alt_texts_json, price, currency, status, source,
          change_note, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'etsy_api', 'Etsy API sync', ?)
      `,
    )
    .bind(
      listingId,
      listing.last_modified_timestamp
        ? new Date(listing.last_modified_timestamp * 1000).toISOString()
        : new Date().toISOString(),
      listing.title ?? "",
      json(listing.tags),
      listing.description ?? "",
      json(images.map((image) => image.alt_text).filter(Boolean)),
      price,
      listing.price?.currency_code ?? "USD",
      state,
      contentHash,
    )
    .run();
  const versionId = insert.meta?.last_row_id;
  if (versionId) {
    await db
      .prepare("UPDATE listings SET current_version_id = ? WHERE listing_id = ?")
      .bind(versionId, listingId)
      .run();
  }
}

export async function upsertReceipt(
  env: Env,
  shopId: string,
  receipt: EtsyReceipt,
): Promise<"inserted" | "updated"> {
  const receiptId = String(receipt.receipt_id);
  const existing = await env.DB.prepare(
    "SELECT receipt_id FROM etsy_api_receipts WHERE receipt_id = ?",
  )
    .bind(receiptId)
    .first();
  const buyer = receipt.buyer_user_id
    ? await buyerHash(env.ETSY_BUYER_HMAC_SECRET, shopId, String(receipt.buyer_user_id))
    : null;
  const moneys = [
    receipt.grandtotal,
    receipt.subtotal,
    receipt.total_price,
    receipt.total_shipping_cost,
    receipt.total_tax_cost,
    receipt.total_vat_cost,
    receipt.discount_amt,
  ].flatMap(moneyValues);
  await env.DB
    .prepare(
      `
        INSERT INTO etsy_api_receipts (
          receipt_id, shop_id, buyer_hash, city, country_iso, status, payment_method,
          is_paid, is_shipped, was_paid, was_shipped, was_canceled,
          create_timestamp, update_timestamp, paid_timestamp, shipped_timestamp,
          grandtotal_amount, grandtotal_divisor, grandtotal_currency,
          subtotal_amount, subtotal_divisor, subtotal_currency,
          total_price_amount, total_price_divisor, total_price_currency,
          total_shipping_cost_amount, total_shipping_cost_divisor, total_shipping_cost_currency,
          total_tax_cost_amount, total_tax_cost_divisor, total_tax_cost_currency,
          total_vat_cost_amount, total_vat_cost_divisor, total_vat_cost_currency,
          discount_amt_amount, discount_amt_divisor, discount_amt_currency, synced_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        )
        ON CONFLICT(receipt_id) DO UPDATE SET
          buyer_hash=excluded.buyer_hash, city=excluded.city, country_iso=excluded.country_iso,
          status=excluded.status, payment_method=excluded.payment_method,
          is_paid=excluded.is_paid, is_shipped=excluded.is_shipped,
          was_paid=excluded.was_paid, was_shipped=excluded.was_shipped,
          was_canceled=excluded.was_canceled, create_timestamp=excluded.create_timestamp,
          update_timestamp=excluded.update_timestamp, paid_timestamp=excluded.paid_timestamp,
          shipped_timestamp=excluded.shipped_timestamp,
          grandtotal_amount=excluded.grandtotal_amount,
          grandtotal_divisor=excluded.grandtotal_divisor,
          grandtotal_currency=excluded.grandtotal_currency,
          subtotal_amount=excluded.subtotal_amount, subtotal_divisor=excluded.subtotal_divisor,
          subtotal_currency=excluded.subtotal_currency,
          total_price_amount=excluded.total_price_amount,
          total_price_divisor=excluded.total_price_divisor,
          total_price_currency=excluded.total_price_currency,
          total_shipping_cost_amount=excluded.total_shipping_cost_amount,
          total_shipping_cost_divisor=excluded.total_shipping_cost_divisor,
          total_shipping_cost_currency=excluded.total_shipping_cost_currency,
          total_tax_cost_amount=excluded.total_tax_cost_amount,
          total_tax_cost_divisor=excluded.total_tax_cost_divisor,
          total_tax_cost_currency=excluded.total_tax_cost_currency,
          total_vat_cost_amount=excluded.total_vat_cost_amount,
          total_vat_cost_divisor=excluded.total_vat_cost_divisor,
          total_vat_cost_currency=excluded.total_vat_cost_currency,
          discount_amt_amount=excluded.discount_amt_amount,
          discount_amt_divisor=excluded.discount_amt_divisor,
          discount_amt_currency=excluded.discount_amt_currency,
          synced_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      receiptId,
      shopId,
      buyer,
      receipt.city ?? null,
      receipt.country_iso ?? null,
      receipt.status ?? null,
      receipt.payment_method ?? null,
      receipt.is_paid ? 1 : 0,
      receipt.is_shipped ? 1 : 0,
      receipt.was_paid ? 1 : 0,
      receipt.was_shipped ? 1 : 0,
      receipt.was_canceled ? 1 : 0,
      timestamp(receipt.created_timestamp ?? receipt.create_timestamp),
      timestamp(receipt.updated_timestamp ?? receipt.update_timestamp),
      timestamp(receipt.paid_timestamp),
      timestamp(receipt.shipped_timestamp),
      ...moneys,
    )
    .run();
  for (const transaction of receipt.transactions ?? []) {
    await upsertTransaction(env.DB, receiptId, transaction);
  }
  await replaceReceiptRefunds(env.DB, receiptId, receipt.refunds ?? []);
  return existing ? "updated" : "inserted";
}

/**
 * Etsy's ShopRefund object has no unique ID, so refunds cannot be upserted by
 * key. Each sync replaces the full refund set for the receipt instead, which
 * is safe and idempotent since the source array is always the complete,
 * current list of refunds for that receipt.
 */
async function replaceReceiptRefunds(
  db: D1Database,
  receiptId: string,
  refunds: ShopRefund[],
): Promise<void> {
  const statements = [
    db.prepare("DELETE FROM etsy_api_receipt_refunds WHERE receipt_id = ?").bind(receiptId),
    ...refunds.map((refund) => {
      const [amount, amountDivisor, amountCurrency] = moneyValues(refund.amount);
      return db
        .prepare(
          `
            INSERT INTO etsy_api_receipt_refunds (
              receipt_id, amount, amount_divisor, amount_currency,
              created_timestamp, reason, note_from_issuer, status, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `,
        )
        .bind(
          receiptId,
          amount,
          amountDivisor,
          amountCurrency,
          timestamp(refund.created_timestamp),
          refund.reason ?? null,
          refund.note_from_issuer ?? null,
          refund.status ?? null,
        );
    }),
  ];
  await db.batch(statements);
}

async function upsertTransaction(
  db: D1Database,
  receiptId: string,
  transaction: EtsyTransaction,
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO etsy_api_transactions (
          transaction_id, receipt_id, listing_id, title, quantity, sku,
          variations_json, product_data_json,
          price_amount, price_divisor, price_currency,
          shipping_cost_amount, shipping_cost_divisor, shipping_cost_currency,
          create_timestamp, paid_timestamp, shipped_timestamp, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(transaction_id) DO UPDATE SET
          receipt_id=excluded.receipt_id, listing_id=excluded.listing_id,
          title=excluded.title, quantity=excluded.quantity, sku=excluded.sku,
          variations_json=excluded.variations_json,
          product_data_json=excluded.product_data_json,
          price_amount=excluded.price_amount, price_divisor=excluded.price_divisor,
          price_currency=excluded.price_currency,
          shipping_cost_amount=excluded.shipping_cost_amount,
          shipping_cost_divisor=excluded.shipping_cost_divisor,
          shipping_cost_currency=excluded.shipping_cost_currency,
          create_timestamp=excluded.create_timestamp,
          paid_timestamp=excluded.paid_timestamp,
          shipped_timestamp=excluded.shipped_timestamp, synced_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      String(transaction.transaction_id),
      receiptId,
      textId(transaction.listing_id),
      transaction.title ?? "",
      transaction.quantity ?? 0,
      transaction.sku ?? null,
      json(transaction.variations),
      json(transaction.product_data),
      ...moneyValues(transaction.price),
      ...moneyValues(transaction.shipping_cost),
      timestamp(transaction.created_timestamp ?? transaction.create_timestamp),
      timestamp(transaction.paid_timestamp),
      timestamp(transaction.shipped_timestamp),
    )
    .run();
}

export async function upsertPayment(
  db: D1Database,
  shopId: string,
  payment: EtsyPayment,
): Promise<void> {
  const money = [
    payment.amount_gross,
    payment.amount_fees,
    payment.amount_net,
    payment.posted_gross,
    payment.posted_fees,
    payment.posted_net,
    payment.adjusted_gross,
    payment.adjusted_fees,
    payment.adjusted_net,
  ].flatMap(moneyValues);
  await db
    .prepare(
      `
        INSERT INTO etsy_api_payments (
          payment_id, shop_id, receipt_id, status, payment_method,
          currency, shop_currency, buyer_currency,
          amount_gross, amount_gross_divisor, amount_gross_currency,
          amount_fees, amount_fees_divisor, amount_fees_currency,
          amount_net, amount_net_divisor, amount_net_currency,
          posted_gross, posted_gross_divisor, posted_gross_currency,
          posted_fees, posted_fees_divisor, posted_fees_currency,
          posted_net, posted_net_divisor, posted_net_currency,
          adjusted_gross, adjusted_gross_divisor, adjusted_gross_currency,
          adjusted_fees, adjusted_fees_divisor, adjusted_fees_currency,
          adjusted_net, adjusted_net_divisor, adjusted_net_currency,
          create_timestamp, update_timestamp, synced_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        )
        ON CONFLICT(payment_id) DO UPDATE SET
          receipt_id=excluded.receipt_id, status=excluded.status,
          payment_method=excluded.payment_method,
          currency=excluded.currency, shop_currency=excluded.shop_currency,
          buyer_currency=excluded.buyer_currency,
          amount_gross=excluded.amount_gross, amount_gross_divisor=excluded.amount_gross_divisor,
          amount_gross_currency=excluded.amount_gross_currency,
          amount_fees=excluded.amount_fees, amount_fees_divisor=excluded.amount_fees_divisor,
          amount_fees_currency=excluded.amount_fees_currency,
          amount_net=excluded.amount_net, amount_net_divisor=excluded.amount_net_divisor,
          amount_net_currency=excluded.amount_net_currency,
          posted_gross=excluded.posted_gross, posted_gross_divisor=excluded.posted_gross_divisor,
          posted_gross_currency=excluded.posted_gross_currency,
          posted_fees=excluded.posted_fees, posted_fees_divisor=excluded.posted_fees_divisor,
          posted_fees_currency=excluded.posted_fees_currency,
          posted_net=excluded.posted_net, posted_net_divisor=excluded.posted_net_divisor,
          posted_net_currency=excluded.posted_net_currency,
          adjusted_gross=excluded.adjusted_gross,
          adjusted_gross_divisor=excluded.adjusted_gross_divisor,
          adjusted_gross_currency=excluded.adjusted_gross_currency,
          adjusted_fees=excluded.adjusted_fees,
          adjusted_fees_divisor=excluded.adjusted_fees_divisor,
          adjusted_fees_currency=excluded.adjusted_fees_currency,
          adjusted_net=excluded.adjusted_net,
          adjusted_net_divisor=excluded.adjusted_net_divisor,
          adjusted_net_currency=excluded.adjusted_net_currency,
          create_timestamp=excluded.create_timestamp,
          update_timestamp=excluded.update_timestamp, synced_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      String(payment.payment_id),
      shopId,
      String(payment.receipt_id),
      payment.status ?? null,
      payment.payment_method ?? null,
      payment.currency ?? null,
      payment.shop_currency ?? null,
      payment.buyer_currency ?? null,
      ...money,
      timestamp(payment.created_timestamp ?? payment.create_timestamp),
      timestamp(payment.updated_timestamp ?? payment.update_timestamp),
    )
    .run();

  for (const adjustment of payment.payment_adjustments ?? []) {
    await upsertPaymentAdjustment(db, adjustment);
  }
}

function nullableInt(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function upsertPaymentAdjustment(
  db: D1Database,
  adjustment: PaymentAdjustment,
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO etsy_api_payment_adjustments (
          payment_adjustment_id, payment_id, status, is_success, user_id, reason_code,
          total_adjustment_amount, shop_total_adjustment_amount,
          buyer_total_adjustment_amount, total_fee_adjustment_amount,
          create_timestamp, update_timestamp, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(payment_adjustment_id) DO UPDATE SET
          payment_id=excluded.payment_id, status=excluded.status,
          is_success=excluded.is_success, user_id=excluded.user_id,
          reason_code=excluded.reason_code,
          total_adjustment_amount=excluded.total_adjustment_amount,
          shop_total_adjustment_amount=excluded.shop_total_adjustment_amount,
          buyer_total_adjustment_amount=excluded.buyer_total_adjustment_amount,
          total_fee_adjustment_amount=excluded.total_fee_adjustment_amount,
          create_timestamp=excluded.create_timestamp,
          update_timestamp=excluded.update_timestamp, synced_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      String(adjustment.payment_adjustment_id),
      String(adjustment.payment_id),
      adjustment.status ?? null,
      adjustment.is_success ? 1 : 0,
      textId(adjustment.user_id),
      adjustment.reason_code ?? null,
      nullableInt(adjustment.total_adjustment_amount),
      nullableInt(adjustment.shop_total_adjustment_amount),
      nullableInt(adjustment.buyer_total_adjustment_amount),
      nullableInt(adjustment.total_fee_adjustment_amount),
      timestamp(adjustment.created_timestamp ?? adjustment.create_timestamp),
      timestamp(adjustment.updated_timestamp ?? adjustment.update_timestamp),
    )
    .run();

  for (const item of adjustment.payment_adjustment_items ?? []) {
    await upsertPaymentAdjustmentItem(db, item);
  }
}

async function upsertPaymentAdjustmentItem(
  db: D1Database,
  item: PaymentAdjustmentItem,
): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO etsy_api_payment_adjustment_items (
          payment_adjustment_item_id, payment_adjustment_id, adjustment_type,
          amount, shop_amount, transaction_id, bill_payment_id,
          created_timestamp, updated_timestamp, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(payment_adjustment_item_id) DO UPDATE SET
          payment_adjustment_id=excluded.payment_adjustment_id,
          adjustment_type=excluded.adjustment_type,
          amount=excluded.amount, shop_amount=excluded.shop_amount,
          transaction_id=excluded.transaction_id, bill_payment_id=excluded.bill_payment_id,
          created_timestamp=excluded.created_timestamp,
          updated_timestamp=excluded.updated_timestamp, synced_at=CURRENT_TIMESTAMP
      `,
    )
    .bind(
      String(item.payment_adjustment_item_id),
      String(item.payment_adjustment_id),
      item.adjustment_type ?? null,
      nullableInt(item.amount),
      nullableInt(item.shop_amount),
      textId(item.transaction_id),
      textId(item.bill_payment_id),
      timestamp(item.created_timestamp),
      timestamp(item.updated_timestamp),
    )
    .run();
}

export async function updateResourceProgress(
  _db: D1Database,
  _runId: string,
  _resource: SyncResource,
  _counts: { fetched: number; inserted: number; updated: number; unchanged: number },
): Promise<void> {
  // Phase 9: legacy etsy_sync_resources mirror writes removed. Counters live on
  // etsy_sync_job_resources via the generic engine. Keep this no-op export so
  // any stale import fails closed without touching the legacy table.
}

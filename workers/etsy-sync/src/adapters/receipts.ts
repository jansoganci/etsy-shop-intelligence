import { buyerHash } from "../crypto";
import { EtsyApiError, etsyFetch } from "../etsy";
import type {
  EtsyListResponse,
  EtsyReceipt,
  Money,
} from "../types";
import {
  ETSY_EPOCH_MIN,
  ETSY_OFFSET_MAX,
  deterministicTaskKey,
  normalizePageSize,
  pageKeyForTask,
} from "../engine/planner";
import { loadJobWindow } from "../engine/repository";
import { readEtsyRateHeaders, retryDecision } from "../engine/rateLimit";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  PersistCounts,
  SyncTask,
  TaskPlan,
} from "../engine/types";

type ReceiptCursor = {
  filter: "created" | "modified";
  mode: "backfill" | "incremental" | "catchup" | "manual_period";
  maxSeenTimestamp?: number;
};

function cursor(task: SyncTask): ReceiptCursor {
  const raw = task.cursor as Partial<ReceiptCursor>;
  return {
    filter: raw.filter === "modified" ? "modified" : "created",
    mode:
      raw.mode === "incremental" ||
      raw.mode === "catchup" ||
      raw.mode === "manual_period"
        ? raw.mode
        : "backfill",
    maxSeenTimestamp:
      typeof raw.maxSeenTimestamp === "number" ? raw.maxSeenTimestamp : undefined,
  };
}

function timestamp(value: number | undefined): number | null {
  return Number.isFinite(value) ? value! : null;
}

function textId(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value);
}

export class ReceiptsAdapter implements EtsyResourceAdapter<EtsyReceipt> {
  readonly resource = "receipts";
  readonly version = 1;
  readonly strategy = "time_windowed" as const;
  readonly dependencies = ["shop"] as const;
  readonly deletionPolicy = "none" as const;

  async planInitial(
    context: AdapterContext,
    runId: string,
    shopId: string,
  ): Promise<TaskPlan[]> {
    const window = await loadJobWindow(context.db, runId);
    if (
      window?.isPeriodRun &&
      typeof window.periodFromTs === "number" &&
      typeof window.periodToTs === "number"
    ) {
      const segmentStart = window.periodFromTs;
      const segmentEnd = window.periodToTs - 1;
      const mode: ReceiptCursor["mode"] = "manual_period";
      return [
        {
          resource: this.resource,
          adapterVersion: this.version,
          strategy: this.strategy,
          idempotencyKey: deterministicTaskKey(
            runId,
            this.resource,
            this.strategy,
            segmentStart,
            segmentEnd,
            0,
            mode,
          ),
          cursor: {
            filter: "created",
            mode,
            maxSeenTimestamp: 0,
          },
          segmentStart,
          segmentEnd,
          pageOffset: 0,
          pageSize: 100,
        },
      ];
    }

    const prior = await context.db
      .prepare(
        `
          SELECT cursor_value FROM etsy_sync_cursors
          WHERE shop_id=? AND resource='sales' AND cursor_key='last_modified'
        `,
      )
      .bind(shopId)
      .first<{ cursor_value: string | null }>();
    const now = Math.floor(context.now.getTime() / 1000);
    const previous = Number(prior?.cursor_value);
    const incremental = Number.isFinite(previous) && previous >= ETSY_EPOCH_MIN;
    const start = incremental ? Math.max(ETSY_EPOCH_MIN, previous - 3600) : ETSY_EPOCH_MIN;
    const mode: ReceiptCursor["mode"] = incremental ? "incremental" : "backfill";
    return [
      {
        resource: this.resource,
        adapterVersion: this.version,
        strategy: this.strategy,
        idempotencyKey: deterministicTaskKey(
          runId,
          this.resource,
          this.strategy,
          start,
          now,
          0,
          mode,
        ),
        cursor: {
          filter: incremental ? "modified" : "created",
          mode,
          maxSeenTimestamp: previous || 0,
        },
        segmentStart: start,
        segmentEnd: now,
        pageOffset: 0,
        pageSize: 100,
      },
    ];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<EtsyReceipt>> {
    if (task.segmentStart == null || task.segmentEnd == null) {
      throw new EtsyApiError(400, "receipt_segment_missing", "Receipt task has no time window.");
    }
    if (task.pageOffset > ETSY_OFFSET_MAX) {
      throw new EtsyApiError(
        400,
        "source_pagination_exhausted",
        "Etsy receipt offset limit would be exceeded.",
      );
    }
    const state = cursor(task);
    const query = new URLSearchParams({
      limit: String(normalizePageSize(task.pageSize)),
      offset: String(task.pageOffset),
      sort_on: state.filter === "modified" ? "updated" : "created",
      sort_order: "asc",
    });
    if (state.filter === "modified") {
      query.set("min_last_modified", String(task.segmentStart));
      query.set("max_last_modified", String(task.segmentEnd));
    } else {
      query.set("min_created", String(task.segmentStart));
      query.set("max_created", String(task.segmentEnd));
    }
    const response = await etsyFetch<EtsyListResponse<EtsyReceipt>>(
      context.env,
      task.shopId,
      `/v3/application/shops/${task.shopId}/receipts`,
      query,
    );
    const records = response.body.results ?? [];
    const rate = readEtsyRateHeaders(response.headers);
    const maxSeenTimestamp = records.reduce(
      (value, receipt) =>
        Math.max(
          value,
          receipt.updated_timestamp ??
            receipt.update_timestamp ??
            receipt.created_timestamp ??
            receipt.create_timestamp ??
            0,
        ),
      cursor(task).maxSeenTimestamp ?? 0,
    );
    const nextOffset = task.pageOffset + records.length;
    const responseCount =
      typeof response.body.count === "number" ? response.body.count : null;
    const hasMore =
      responseCount != null
        ? nextOffset < responseCount
        : records.length === normalizePageSize(task.pageSize);
    // Always retain maxSeenTimestamp in nextCursor — including the final page —
    // so commitPage does not wipe the watermark with `{}` before finalize.
    // `complete: true` signals end-of-pages; runtime treats that as done.
    return {
      records,
      responseCount,
      nextCursor: {
        ...state,
        maxSeenTimestamp,
        offset: nextOffset,
        ...(hasMore ? {} : { complete: true }),
      },
      pageKey: pageKeyForTask(task),
      ...rate,
    };
  }

  async persistPage(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<EtsyReceipt>,
  ): Promise<PersistCounts> {
    if (page.records.length === 0) {
      return { source: 0, fetched: 0, inserted: 0, updated: 0, unchanged: 0 };
    }
    const ids = page.records.map((receipt) => String(receipt.receipt_id));
    const existingRows = await context.db
      .prepare(
        `
          SELECT receipt_id FROM etsy_api_receipts
          WHERE receipt_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        `,
      )
      .bind(JSON.stringify(ids))
      .all<{ receipt_id: string }>();
    const existing = new Set((existingRows.results ?? []).map((row) => row.receipt_id));
    const buyerHashes = await Promise.all(
      page.records.map((receipt) =>
        receipt.buyer_user_id
          ? buyerHash(
              context.env.ETSY_BUYER_HMAC_SECRET,
              task.shopId,
              String(receipt.buyer_user_id),
            )
          : Promise.resolve(null),
      ),
    );
    const receipts = page.records.map((receipt, index) => {
      const money = (value: Money | undefined) => ({
        amount: Number.isFinite(value?.amount) ? value!.amount! : null,
        divisor: Number.isFinite(value?.divisor) ? value!.divisor! : null,
        currency: value?.currency_code ?? null,
      });
      return {
        receiptId: String(receipt.receipt_id),
        shopId: task.shopId,
        buyerHash: buyerHashes[index],
        city: receipt.city ?? null,
        countryIso: receipt.country_iso ?? null,
        status: receipt.status ?? null,
        paymentMethod: receipt.payment_method ?? null,
        isPaid: receipt.is_paid ? 1 : 0,
        isShipped: receipt.is_shipped ? 1 : 0,
        wasPaid: receipt.was_paid ? 1 : 0,
        wasShipped: receipt.was_shipped ? 1 : 0,
        wasCanceled: receipt.was_canceled ? 1 : 0,
        createTimestamp: timestamp(receipt.created_timestamp ?? receipt.create_timestamp),
        updateTimestamp: timestamp(receipt.updated_timestamp ?? receipt.update_timestamp),
        paidTimestamp: timestamp(receipt.paid_timestamp),
        shippedTimestamp: timestamp(receipt.shipped_timestamp),
        grandtotal: money(receipt.grandtotal),
        subtotal: money(receipt.subtotal),
        totalPrice: money(receipt.total_price),
        shipping: money(receipt.total_shipping_cost),
        tax: money(receipt.total_tax_cost),
        vat: money(receipt.total_vat_cost),
        discount: money(receipt.discount_amt),
      };
    });
    const transactions = page.records.flatMap((receipt) =>
      (receipt.transactions ?? []).map((transaction) => ({
        receiptId: String(receipt.receipt_id),
        transactionId: String(transaction.transaction_id),
        listingId: textId(transaction.listing_id),
        title: transaction.title ?? "",
        quantity: transaction.quantity ?? 0,
        sku: transaction.sku ?? null,
        variations: transaction.variations ?? [],
        productData: transaction.product_data ?? [],
        price: {
          amount: transaction.price?.amount ?? null,
          divisor: transaction.price?.divisor ?? null,
          currency: transaction.price?.currency_code ?? null,
        },
        shipping: {
          amount: transaction.shipping_cost?.amount ?? null,
          divisor: transaction.shipping_cost?.divisor ?? null,
          currency: transaction.shipping_cost?.currency_code ?? null,
        },
        createTimestamp: timestamp(
          transaction.created_timestamp ?? transaction.create_timestamp,
        ),
        paidTimestamp: timestamp(transaction.paid_timestamp),
        shippedTimestamp: timestamp(transaction.shipped_timestamp),
      })),
    );
    const refunds = page.records.flatMap((receipt) =>
      (receipt.refunds ?? []).map((refund) => ({
        receiptId: String(receipt.receipt_id),
        amount: refund.amount?.amount ?? null,
        divisor: refund.amount?.divisor ?? null,
        currency: refund.amount?.currency_code ?? null,
        createdTimestamp: timestamp(refund.created_timestamp),
        reason: refund.reason ?? null,
        note: refund.note_from_issuer ?? null,
        status: refund.status ?? null,
      })),
    );
    const receiptJson = JSON.stringify(receipts);
    const transactionJson = JSON.stringify(transactions);
    const refundJson = JSON.stringify(refunds);
    const idJson = JSON.stringify(ids);
    // Four transactional write statements cover the complete 100-receipt Etsy
    // page. This remains far below the D1 Free per-invocation query budget and
    // makes Queue replay safe without row-by-row existence reads.
    await context.db.batch([
      context.db
        .prepare(
          `
            INSERT INTO etsy_api_receipts (
              receipt_id, shop_id, buyer_hash, city, country_iso, status,
              payment_method, is_paid, is_shipped, was_paid, was_shipped,
              was_canceled, create_timestamp, update_timestamp, paid_timestamp,
              shipped_timestamp, grandtotal_amount, grandtotal_divisor,
              grandtotal_currency, subtotal_amount, subtotal_divisor,
              subtotal_currency, total_price_amount, total_price_divisor,
              total_price_currency, total_shipping_cost_amount,
              total_shipping_cost_divisor, total_shipping_cost_currency,
              total_tax_cost_amount, total_tax_cost_divisor,
              total_tax_cost_currency, total_vat_cost_amount,
              total_vat_cost_divisor, total_vat_cost_currency,
              discount_amt_amount, discount_amt_divisor, discount_amt_currency,
              synced_at
            )
            SELECT
              json_extract(value,'$.receiptId'), json_extract(value,'$.shopId'),
              json_extract(value,'$.buyerHash'), json_extract(value,'$.city'),
              json_extract(value,'$.countryIso'), json_extract(value,'$.status'),
              json_extract(value,'$.paymentMethod'), json_extract(value,'$.isPaid'),
              json_extract(value,'$.isShipped'), json_extract(value,'$.wasPaid'),
              json_extract(value,'$.wasShipped'), json_extract(value,'$.wasCanceled'),
              json_extract(value,'$.createTimestamp'), json_extract(value,'$.updateTimestamp'),
              json_extract(value,'$.paidTimestamp'), json_extract(value,'$.shippedTimestamp'),
              json_extract(value,'$.grandtotal.amount'), json_extract(value,'$.grandtotal.divisor'),
              json_extract(value,'$.grandtotal.currency'), json_extract(value,'$.subtotal.amount'),
              json_extract(value,'$.subtotal.divisor'), json_extract(value,'$.subtotal.currency'),
              json_extract(value,'$.totalPrice.amount'), json_extract(value,'$.totalPrice.divisor'),
              json_extract(value,'$.totalPrice.currency'), json_extract(value,'$.shipping.amount'),
              json_extract(value,'$.shipping.divisor'), json_extract(value,'$.shipping.currency'),
              json_extract(value,'$.tax.amount'), json_extract(value,'$.tax.divisor'),
              json_extract(value,'$.tax.currency'), json_extract(value,'$.vat.amount'),
              json_extract(value,'$.vat.divisor'), json_extract(value,'$.vat.currency'),
              json_extract(value,'$.discount.amount'), json_extract(value,'$.discount.divisor'),
              json_extract(value,'$.discount.currency'), CURRENT_TIMESTAMP
            FROM json_each(?) WHERE 1
            ON CONFLICT(receipt_id) DO UPDATE SET
              shop_id=excluded.shop_id, buyer_hash=excluded.buyer_hash,
              city=excluded.city, country_iso=excluded.country_iso,
              status=excluded.status, payment_method=excluded.payment_method,
              is_paid=excluded.is_paid, is_shipped=excluded.is_shipped,
              was_paid=excluded.was_paid, was_shipped=excluded.was_shipped,
              was_canceled=excluded.was_canceled,
              create_timestamp=excluded.create_timestamp,
              update_timestamp=excluded.update_timestamp,
              paid_timestamp=excluded.paid_timestamp,
              shipped_timestamp=excluded.shipped_timestamp,
              grandtotal_amount=excluded.grandtotal_amount,
              grandtotal_divisor=excluded.grandtotal_divisor,
              grandtotal_currency=excluded.grandtotal_currency,
              subtotal_amount=excluded.subtotal_amount,
              subtotal_divisor=excluded.subtotal_divisor,
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
        .bind(receiptJson),
      context.db
        .prepare(
          `
            INSERT INTO etsy_api_transactions (
              transaction_id, receipt_id, listing_id, title, quantity, sku,
              variations_json, product_data_json, price_amount, price_divisor,
              price_currency, shipping_cost_amount, shipping_cost_divisor,
              shipping_cost_currency, create_timestamp, paid_timestamp,
              shipped_timestamp, synced_at
            )
            SELECT
              json_extract(value,'$.transactionId'), json_extract(value,'$.receiptId'),
              json_extract(value,'$.listingId'), json_extract(value,'$.title'),
              json_extract(value,'$.quantity'), json_extract(value,'$.sku'),
              json(json_extract(value,'$.variations')),
              json(json_extract(value,'$.productData')),
              json_extract(value,'$.price.amount'), json_extract(value,'$.price.divisor'),
              json_extract(value,'$.price.currency'), json_extract(value,'$.shipping.amount'),
              json_extract(value,'$.shipping.divisor'), json_extract(value,'$.shipping.currency'),
              json_extract(value,'$.createTimestamp'), json_extract(value,'$.paidTimestamp'),
              json_extract(value,'$.shippedTimestamp'), CURRENT_TIMESTAMP
            FROM json_each(?) WHERE 1
            ON CONFLICT(transaction_id) DO UPDATE SET
              receipt_id=excluded.receipt_id, listing_id=excluded.listing_id,
              title=excluded.title, quantity=excluded.quantity, sku=excluded.sku,
              variations_json=excluded.variations_json,
              product_data_json=excluded.product_data_json,
              price_amount=excluded.price_amount,
              price_divisor=excluded.price_divisor,
              price_currency=excluded.price_currency,
              shipping_cost_amount=excluded.shipping_cost_amount,
              shipping_cost_divisor=excluded.shipping_cost_divisor,
              shipping_cost_currency=excluded.shipping_cost_currency,
              create_timestamp=excluded.create_timestamp,
              paid_timestamp=excluded.paid_timestamp,
              shipped_timestamp=excluded.shipped_timestamp,
              synced_at=CURRENT_TIMESTAMP
          `,
        )
        .bind(transactionJson),
      context.db
        .prepare(
          `
            DELETE FROM etsy_api_receipt_refunds
            WHERE receipt_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          `,
        )
        .bind(idJson),
      context.db
        .prepare(
          `
            INSERT INTO etsy_api_receipt_refunds (
              receipt_id, amount, amount_divisor, amount_currency,
              created_timestamp, reason, note_from_issuer, status, synced_at
            )
            SELECT
              json_extract(value,'$.receiptId'), json_extract(value,'$.amount'),
              json_extract(value,'$.divisor'), json_extract(value,'$.currency'),
              json_extract(value,'$.createdTimestamp'), json_extract(value,'$.reason'),
              json_extract(value,'$.note'), json_extract(value,'$.status'),
              CURRENT_TIMESTAMP
            FROM json_each(?)
          `,
        )
        .bind(refundJson),
    ]);
    const transactionCount = transactions.length;
    const inserted = ids.filter((id) => !existing.has(id)).length;
    return {
      source: page.records.length,
      fetched: page.records.length + transactionCount,
      inserted,
      updated: page.records.length - inserted,
      unchanged: 0,
    };
  }

  async planNext(
    _context: AdapterContext,
    _task: SyncTask,
    _page: AdapterPage<EtsyReceipt>,
  ): Promise<TaskPlan[]> {
    // Pages advance within the same durable task. Oversized windows and final
    // catch-up tasks are planned by the generic engine around this adapter.
    return [];
  }

  async planFinal(
    context: AdapterContext,
    runId: string,
    _shopId: string,
  ): Promise<TaskPlan[]> {
    const window = await loadJobWindow(context.db, runId);
    if (window?.isPeriodRun) return [];

    const catchup = await context.db
      .prepare(
        `
          SELECT status FROM etsy_sync_tasks
          WHERE run_id=? AND resource='receipts'
            AND json_extract(cursor_json, '$.mode')='catchup'
          LIMIT 1
        `,
      )
      .bind(runId)
      .first<{ status: string }>();
    if (catchup) return [];
    const backfill = await context.db
      .prepare(
        `
          SELECT COUNT(*) AS count FROM etsy_sync_tasks
          WHERE run_id=? AND resource='receipts'
            AND json_extract(cursor_json, '$.mode')='backfill'
        `,
      )
      .bind(runId)
      .first<{ count: number }>();
    if (!backfill?.count) return [];
    const job = await context.db
      .prepare("SELECT started_at, created_at FROM etsy_sync_jobs WHERE id=?")
      .bind(runId)
      .first<{ started_at: string | null; created_at: string }>();
    const startMs = Date.parse(job?.started_at ?? job?.created_at ?? context.now.toISOString());
    const start = Math.max(ETSY_EPOCH_MIN, Math.floor(startMs / 1000) - 3600);
    const end = Math.floor(context.now.getTime() / 1000);
    return [
      {
        resource: this.resource,
        adapterVersion: this.version,
        strategy: this.strategy,
        idempotencyKey: deterministicTaskKey(
          runId,
          this.resource,
          this.strategy,
          start,
          end,
          0,
          "catchup",
        ),
        cursor: { filter: "modified", mode: "catchup", maxSeenTimestamp: 0 },
        segmentStart: start,
        segmentEnd: end,
        pageOffset: 0,
        pageSize: 100,
      },
    ];
  }

  retryPolicy(error: unknown, attempt: number) {
    return retryDecision(error, attempt);
  }
}

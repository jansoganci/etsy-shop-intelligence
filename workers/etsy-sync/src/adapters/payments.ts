import { EtsyApiError, etsyFetch } from "../etsy";
import { deterministicTaskKey } from "../engine/planner";
import { readEtsyRateHeaders, retryDecision, type EtsyRateHeaders } from "../engine/rateLimit";
import type {
  AdapterContext,
  AdapterPage,
  EtsyResourceAdapter,
  PersistCounts,
  SyncTask,
  TaskPlan,
} from "../engine/types";
import type { EtsyListResponse, EtsyPayment } from "../types";
import { NO_RATE_HEADERS } from "./common";

type ReceiptPayments = {
  receiptId: string;
  payments: EtsyPayment[];
  wasNotFound: boolean;
};

type PaymentsCursor = {
  parentBatchSize: number;
  afterCreateTimestamp: number | null;
  afterReceiptId: string | null;
  maxSeenTimestamp: number;
  complete?: boolean;
};

const DEFAULT_BATCH = 5;

function mergeRates(current: EtsyRateHeaders, next: EtsyRateHeaders): EtsyRateHeaders {
  const minimum = (a: number | null, b: number | null) =>
    a == null ? b : b == null ? a : Math.min(a, b);
  return {
    qpsLimit: next.qpsLimit ?? current.qpsLimit,
    qpsRemaining: minimum(current.qpsRemaining, next.qpsRemaining),
    qpdLimit: next.qpdLimit ?? current.qpdLimit,
    qpdRemaining: minimum(current.qpdRemaining, next.qpdRemaining),
  };
}

function cursorOf(task: SyncTask): PaymentsCursor {
  const raw = task.cursor ?? {};
  return {
    parentBatchSize:
      typeof raw.parentBatchSize === "number" && raw.parentBatchSize > 0
        ? Math.min(10, Math.floor(raw.parentBatchSize))
        : DEFAULT_BATCH,
    afterCreateTimestamp:
      typeof raw.afterCreateTimestamp === "number" ? raw.afterCreateTimestamp : null,
    afterReceiptId:
      typeof raw.afterReceiptId === "string" ? raw.afterReceiptId : null,
    maxSeenTimestamp:
      typeof raw.maxSeenTimestamp === "number" ? raw.maxSeenTimestamp : 0,
  };
}

function nextRecheckIso(checkCount: number, now: Date): string {
  // Decaying recheck: 1d → 7d → 30d for unpaid / 404 receipts.
  const days = checkCount <= 1 ? 1 : checkCount === 2 ? 7 : 30;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export class PaymentsAdapter implements EtsyResourceAdapter<ReceiptPayments> {
  readonly resource = "payments";
  readonly version = 2;
  readonly strategy = "parent_fanout" as const;
  readonly dependencies = ["receipts"] as const;
  readonly deletionPolicy = "parent_snapshot" as const;

  async planInitial(
    _context: AdapterContext,
    runId: string,
  ): Promise<TaskPlan[]> {
    return [{
      resource: this.resource,
      adapterVersion: this.version,
      strategy: this.strategy,
      idempotencyKey: deterministicTaskKey(runId, this.resource, this.strategy, null, null, 0),
      cursor: {
        parentBatchSize: DEFAULT_BATCH,
        afterCreateTimestamp: null,
        afterReceiptId: null,
        maxSeenTimestamp: 0,
      },
      pageOffset: 0,
      pageSize: DEFAULT_BATCH,
    }];
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<ReceiptPayments>> {
    const state = cursorOf(task);
    const batchSize = Math.max(1, Math.min(10, task.pageSize || state.parentBatchSize));
    const nowIso = context.now.toISOString();
    const periodRun = task.isPeriodRun ? 1 : 0;
    const periodFrom = task.isPeriodRun ? task.periodFromTs : null;
    const periodToExclusive = task.isPeriodRun ? task.periodToTs : null;

    // Delta parents via keyset:
    // - missing payment row, OR
    // - receipt updated after payment was last synced, OR
    // - 404 probe is due for recheck
    // Period runs bypass the delta predicate and recheck every receipt in the
    // job window (§0.3 full refresh).
    const rows = await context.db
      .prepare(
        `
          SELECT r.receipt_id AS receipt_id, r.create_timestamp AS create_timestamp
          FROM etsy_api_receipts r
          LEFT JOIN (
            SELECT receipt_id, MAX(synced_at) AS synced_at,
              MAX(update_timestamp) AS payment_update_timestamp
            FROM etsy_api_payments
            GROUP BY receipt_id
          ) p ON p.receipt_id = r.receipt_id
          LEFT JOIN etsy_api_payment_probes probe ON probe.receipt_id = r.receipt_id
          WHERE r.shop_id = ?
            AND (
              ? = 1
              OR (
                p.receipt_id IS NULL
                OR (
                  r.update_timestamp IS NOT NULL
                  AND (
                    (p.payment_update_timestamp IS NOT NULL AND r.update_timestamp > p.payment_update_timestamp)
                    OR (
                      p.synced_at IS NOT NULL
                      AND r.update_timestamp > CAST(strftime('%s', p.synced_at) AS INTEGER)
                    )
                  )
                )
                OR (
                  probe.next_recheck_at IS NOT NULL
                  AND probe.next_recheck_at <= ?
                )
              )
            )
            AND (
              ? IS NULL
              OR (r.create_timestamp >= ? AND r.create_timestamp < ?)
            )
            AND (
              ? IS NULL
              OR r.create_timestamp > ?
              OR (r.create_timestamp = ? AND r.receipt_id > ?)
            )
          ORDER BY r.create_timestamp, r.receipt_id
          LIMIT ?
        `,
      )
      .bind(
        task.shopId,
        periodRun,
        nowIso,
        periodFrom,
        periodFrom,
        periodToExclusive,
        state.afterCreateTimestamp,
        state.afterCreateTimestamp,
        state.afterCreateTimestamp,
        state.afterReceiptId,
        batchSize,
      )
      .all<{ receipt_id: string; create_timestamp: number }>();

    const parents = rows.results ?? [];
    const records: ReceiptPayments[] = [];
    let rate = { ...NO_RATE_HEADERS };
    let maxSeenTimestamp = state.maxSeenTimestamp;

    for (const parent of parents) {
      maxSeenTimestamp = Math.max(maxSeenTimestamp, Number(parent.create_timestamp) || 0);
      try {
        const response = await etsyFetch<EtsyListResponse<EtsyPayment>>(
          context.env,
          task.shopId,
          `/v3/application/shops/${task.shopId}/receipts/${parent.receipt_id}/payments`,
        );
        records.push({
          receiptId: parent.receipt_id,
          payments: response.body.results ?? [],
          wasNotFound: false,
        });
        rate = mergeRates(rate, readEtsyRateHeaders(response.headers));
      } catch (error) {
        // Etsy creates a payment only after fulfillment. A valid receipt can
        // therefore return 404 until its payment exists.
        if (!(error instanceof EtsyApiError) || error.status !== 404) throw error;
        records.push({
          receiptId: parent.receipt_id,
          payments: [],
          wasNotFound: true,
        });
      }
    }

    const last = parents[parents.length - 1];
    const hasMore = parents.length === batchSize;
    const nextCursor: PaymentsCursor | null = last
      ? {
          parentBatchSize: batchSize,
          afterCreateTimestamp: Number(last.create_timestamp) || 0,
          afterReceiptId: last.receipt_id,
          maxSeenTimestamp,
          ...(hasMore ? {} : { complete: true }),
        }
      : { ...state, maxSeenTimestamp, complete: true };

    return {
      records,
      responseCount: null,
      nextCursor: nextCursor as unknown as Record<string, unknown>,
      pageKey: `${this.resource}:${state.afterCreateTimestamp ?? "start"}:${state.afterReceiptId ?? "start"}`,
      ...rate,
    };
  }

  async persistPage(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<ReceiptPayments>,
  ): Promise<PersistCounts> {
    const paymentIds = page.records.flatMap((record) =>
      record.payments.map((payment) => String(payment.payment_id)),
    );
    const existingRows = paymentIds.length
      ? await context.db
          .prepare(
            `
              SELECT payment_id FROM etsy_api_payments
              WHERE payment_id IN (
                SELECT CAST(value AS TEXT) FROM json_each(?)
              )
            `,
          )
          .bind(JSON.stringify(paymentIds))
          .all<{ payment_id: string }>()
      : { results: [] };
    const existing = new Set(
      (existingRows.results ?? []).map((row) => row.payment_id),
    );
    const money = (value: EtsyPayment["amount_gross"]) => ({
      amount: value?.amount ?? null,
      divisor: value?.divisor ?? null,
      currency: value?.currency_code ?? null,
    });
    const payments = page.records.flatMap((record) =>
      record.payments.map((payment) => ({
        paymentId: String(payment.payment_id),
        shopId: task.shopId,
        receiptId: String(payment.receipt_id),
        status: payment.status ?? null,
        paymentMethod: payment.payment_method ?? null,
        currency: payment.currency ?? null,
        shopCurrency: payment.shop_currency ?? null,
        buyerCurrency: payment.buyer_currency ?? null,
        amountGross: money(payment.amount_gross),
        amountFees: money(payment.amount_fees),
        amountNet: money(payment.amount_net),
        postedGross: money(payment.posted_gross),
        postedFees: money(payment.posted_fees),
        postedNet: money(payment.posted_net),
        adjustedGross: money(payment.adjusted_gross),
        adjustedFees: money(payment.adjusted_fees),
        adjustedNet: money(payment.adjusted_net),
        createTimestamp:
          payment.created_timestamp ?? payment.create_timestamp ?? null,
        updateTimestamp:
          payment.updated_timestamp ?? payment.update_timestamp ?? null,
      })),
    );
    const adjustments = page.records.flatMap((record) =>
      record.payments.flatMap((payment) =>
        (payment.payment_adjustments ?? []).map((adjustment) => ({
          adjustmentId: String(adjustment.payment_adjustment_id),
          paymentId: String(adjustment.payment_id),
          status: adjustment.status ?? null,
          isSuccess: adjustment.is_success ? 1 : 0,
          userId: adjustment.user_id == null ? null : String(adjustment.user_id),
          reasonCode: adjustment.reason_code ?? null,
          totalAmount: adjustment.total_adjustment_amount ?? null,
          shopTotalAmount: adjustment.shop_total_adjustment_amount ?? null,
          buyerTotalAmount: adjustment.buyer_total_adjustment_amount ?? null,
          totalFeeAmount: adjustment.total_fee_adjustment_amount ?? null,
          createTimestamp:
            adjustment.created_timestamp ?? adjustment.create_timestamp ?? null,
          updateTimestamp:
            adjustment.updated_timestamp ?? adjustment.update_timestamp ?? null,
        })),
      ),
    );
    const adjustmentItems = page.records.flatMap((record) =>
      record.payments.flatMap((payment) =>
        (payment.payment_adjustments ?? []).flatMap((adjustment) =>
          (adjustment.payment_adjustment_items ?? []).map((item) => ({
            itemId: String(item.payment_adjustment_item_id),
            adjustmentId: String(item.payment_adjustment_id),
            adjustmentType: item.adjustment_type ?? null,
            amount: item.amount ?? null,
            shopAmount: item.shop_amount ?? null,
            transactionId:
              item.transaction_id == null ? null : String(item.transaction_id),
            billPaymentId:
              item.bill_payment_id == null ? null : String(item.bill_payment_id),
            createdTimestamp: item.created_timestamp ?? null,
            updatedTimestamp: item.updated_timestamp ?? null,
          })),
        ),
      ),
    );
    const receiptIds = page.records.map((record) => record.receiptId);
    const foundReceiptIds = page.records
      .filter((record) => !record.wasNotFound && record.payments.length > 0)
      .map((record) => record.receiptId);
    const notFound = page.records.filter((record) => record.wasNotFound);

    const statements = [
      context.db
        .prepare(
          `
            DELETE FROM etsy_api_payments
            WHERE receipt_id IN (
              SELECT CAST(value AS TEXT) FROM json_each(?)
            )
          `,
        )
        .bind(JSON.stringify(receiptIds)),
      context.db
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
            )
            SELECT
              json_extract(value,'$.paymentId'), json_extract(value,'$.shopId'),
              json_extract(value,'$.receiptId'), json_extract(value,'$.status'),
              json_extract(value,'$.paymentMethod'), json_extract(value,'$.currency'),
              json_extract(value,'$.shopCurrency'), json_extract(value,'$.buyerCurrency'),
              json_extract(value,'$.amountGross.amount'), json_extract(value,'$.amountGross.divisor'),
              json_extract(value,'$.amountGross.currency'), json_extract(value,'$.amountFees.amount'),
              json_extract(value,'$.amountFees.divisor'), json_extract(value,'$.amountFees.currency'),
              json_extract(value,'$.amountNet.amount'), json_extract(value,'$.amountNet.divisor'),
              json_extract(value,'$.amountNet.currency'), json_extract(value,'$.postedGross.amount'),
              json_extract(value,'$.postedGross.divisor'), json_extract(value,'$.postedGross.currency'),
              json_extract(value,'$.postedFees.amount'), json_extract(value,'$.postedFees.divisor'),
              json_extract(value,'$.postedFees.currency'), json_extract(value,'$.postedNet.amount'),
              json_extract(value,'$.postedNet.divisor'), json_extract(value,'$.postedNet.currency'),
              json_extract(value,'$.adjustedGross.amount'), json_extract(value,'$.adjustedGross.divisor'),
              json_extract(value,'$.adjustedGross.currency'), json_extract(value,'$.adjustedFees.amount'),
              json_extract(value,'$.adjustedFees.divisor'), json_extract(value,'$.adjustedFees.currency'),
              json_extract(value,'$.adjustedNet.amount'), json_extract(value,'$.adjustedNet.divisor'),
              json_extract(value,'$.adjustedNet.currency'), json_extract(value,'$.createTimestamp'),
              json_extract(value,'$.updateTimestamp'), CURRENT_TIMESTAMP
            FROM json_each(?)
          `,
        )
        .bind(JSON.stringify(payments)),
      context.db
        .prepare(
          `
            INSERT INTO etsy_api_payment_adjustments (
              payment_adjustment_id, payment_id, status, is_success, user_id,
              reason_code, total_adjustment_amount, shop_total_adjustment_amount,
              buyer_total_adjustment_amount, total_fee_adjustment_amount,
              create_timestamp, update_timestamp, synced_at
            )
            SELECT
              json_extract(value,'$.adjustmentId'), json_extract(value,'$.paymentId'),
              json_extract(value,'$.status'), json_extract(value,'$.isSuccess'),
              json_extract(value,'$.userId'), json_extract(value,'$.reasonCode'),
              json_extract(value,'$.totalAmount'), json_extract(value,'$.shopTotalAmount'),
              json_extract(value,'$.buyerTotalAmount'), json_extract(value,'$.totalFeeAmount'),
              json_extract(value,'$.createTimestamp'), json_extract(value,'$.updateTimestamp'),
              CURRENT_TIMESTAMP
            FROM json_each(?)
          `,
        )
        .bind(JSON.stringify(adjustments)),
      context.db
        .prepare(
          `
            INSERT INTO etsy_api_payment_adjustment_items (
              payment_adjustment_item_id, payment_adjustment_id, adjustment_type,
              amount, shop_amount, transaction_id, bill_payment_id,
              created_timestamp, updated_timestamp, synced_at
            )
            SELECT
              json_extract(value,'$.itemId'), json_extract(value,'$.adjustmentId'),
              json_extract(value,'$.adjustmentType'), json_extract(value,'$.amount'),
              json_extract(value,'$.shopAmount'), json_extract(value,'$.transactionId'),
              json_extract(value,'$.billPaymentId'), json_extract(value,'$.createdTimestamp'),
              json_extract(value,'$.updatedTimestamp'), CURRENT_TIMESTAMP
            FROM json_each(?)
          `,
        )
        .bind(JSON.stringify(adjustmentItems)),
    ];

    if (foundReceiptIds.length > 0) {
      statements.push(
        context.db
          .prepare(
            `
              DELETE FROM etsy_api_payment_probes
              WHERE receipt_id IN (
                SELECT CAST(value AS TEXT) FROM json_each(?)
              )
            `,
          )
          .bind(JSON.stringify(foundReceiptIds)),
      );
    }

    for (const record of notFound) {
      statements.push(
        context.db
          .prepare(
            `
              INSERT INTO etsy_api_payment_probes (
                receipt_id, shop_id, last_status, last_checked_at,
                next_recheck_at, check_count, created_at, updated_at
              ) VALUES (?, ?, 'not_found', CURRENT_TIMESTAMP, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT(receipt_id) DO UPDATE SET
                last_status='not_found',
                last_checked_at=CURRENT_TIMESTAMP,
                check_count=etsy_api_payment_probes.check_count + 1,
                next_recheck_at=datetime(
                  'now',
                  CASE
                    WHEN etsy_api_payment_probes.check_count + 1 <= 2 THEN '+1 day'
                    WHEN etsy_api_payment_probes.check_count + 1 = 3 THEN '+7 days'
                    ELSE '+30 days'
                  END
                ),
                updated_at=CURRENT_TIMESTAMP
            `,
          )
          .bind(record.receiptId, task.shopId, nextRecheckIso(1, context.now)),
      );
    }

    // The endpoint is a complete parent snapshot. Delete plus all normalized
    // inserts share one D1 transaction, so a crash cannot expose a half-written
    // payment/adjustment tree.
    await context.db.batch(statements);
    const inserted = paymentIds.filter((id) => !existing.has(id)).length;
    return {
      source: paymentIds.length,
      fetched: paymentIds.length,
      inserted,
      updated: paymentIds.length - inserted,
      unchanged: 0,
    };
  }

  async planNext(): Promise<TaskPlan[]> {
    return [];
  }

  retryPolicy(error: unknown, attempt: number) {
    return retryDecision(error, attempt);
  }
}

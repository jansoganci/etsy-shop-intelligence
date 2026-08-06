import { etsyFetch } from "../etsy";
import {
  ETSY_EPOCH_MIN,
  deterministicTaskKey,
  normalizePageSize,
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
import type { EtsyLedgerEntry, EtsyListResponse } from "../types";

export const LEDGER_MAX_SPAN_SECONDS = 30 * 86_400;

/** Longest inclusive span for one calendar month (31 days minus one second). */
const LEDGER_SINGLE_TASK_MAX_SPAN = 31 * 86_400 - 1;

type LedgerCursor = {
  mode: "window" | "manual_period";
  maxSeenTimestamp?: number;
  complete?: boolean;
};

function cursor(task: SyncTask): LedgerCursor {
  const raw = task.cursor as Partial<LedgerCursor>;
  return {
    mode: "window",
    maxSeenTimestamp:
      typeof raw.maxSeenTimestamp === "number" ? raw.maxSeenTimestamp : 0,
    complete: raw.complete === true,
  };
}

export class LedgerEntriesAdapter implements EtsyResourceAdapter<EtsyLedgerEntry> {
  readonly resource = "ledger_entries";
  readonly version = 2;
  readonly strategy = "time_windowed" as const;
  readonly dependencies = ["shop"] as const;
  readonly deletionPolicy = "none" as const;

  async planInitial(
    context: AdapterContext,
    runId: string,
    shopId: string,
  ): Promise<TaskPlan[]> {
    const jobWindow = await loadJobWindow(context.db, runId);
    const isPeriodRun =
      jobWindow?.isPeriodRun === true &&
      typeof jobWindow.periodFromTs === "number" &&
      typeof jobWindow.periodToTs === "number";

    let rangeStart: number;
    let rangeEndInclusive: number;
    let previous = 0;
    let cursorMode: LedgerCursor["mode"] = "window";

    if (isPeriodRun) {
      rangeStart = jobWindow!.periodFromTs!;
      rangeEndInclusive = jobWindow!.periodToTs! - 1;
      cursorMode = "manual_period";
    } else {
      const prior = await context.db
        .prepare(
          `
            SELECT cursor_value FROM etsy_sync_cursors
            WHERE shop_id=? AND resource='ledger_entries' AND cursor_key='last_modified'
          `,
        )
        .bind(shopId)
        .first<{ cursor_value: string | null }>();
      rangeEndInclusive = Math.floor(context.now.getTime() / 1000);
      previous = Number(prior?.cursor_value);
      const incremental = Number.isFinite(previous) && previous >= ETSY_EPOCH_MIN;
      rangeStart = incremental
        ? Math.max(ETSY_EPOCH_MIN, previous - 3600)
        : ETSY_EPOCH_MIN;
    }

    const totalSpan = rangeEndInclusive - rangeStart;
    const segments: Array<{ start: number; end: number }> = [];
    if (totalSpan <= LEDGER_SINGLE_TASK_MAX_SPAN) {
      segments.push({ start: rangeStart, end: rangeEndInclusive });
    } else {
      let start = rangeStart;
      while (start <= rangeEndInclusive) {
        const end = Math.min(start + LEDGER_MAX_SPAN_SECONDS, rangeEndInclusive);
        segments.push({ start, end });
        start = end + 1;
      }
    }

    return segments.map(({ start, end }) => ({
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
      ),
      cursor: { mode: cursorMode, maxSeenTimestamp: previous || 0 },
      segmentStart: start,
      segmentEnd: end,
      pageOffset: 0,
      pageSize: 100,
    }));
  }

  async fetchPage(
    context: AdapterContext,
    task: SyncTask,
  ): Promise<AdapterPage<EtsyLedgerEntry>> {
    if (task.segmentStart == null || task.segmentEnd == null) {
      throw new Error("ledger_segment_missing");
    }
    const pageSize = normalizePageSize(task.pageSize);
    const response = await etsyFetch<EtsyListResponse<EtsyLedgerEntry>>(
      context.env,
      task.shopId,
      `/v3/application/shops/${task.shopId}/payment-account/ledger-entries`,
      new URLSearchParams({
        min_created: String(task.segmentStart),
        max_created: String(task.segmentEnd),
        limit: String(pageSize),
        offset: String(task.pageOffset),
      }),
    );
    const records = response.body.results ?? [];
    const count = typeof response.body.count === "number" ? response.body.count : null;
    const nextOffset = task.pageOffset + records.length;
    const hasMore = count != null ? nextOffset < count : records.length === pageSize;
    const priorMax = cursor(task).maxSeenTimestamp ?? 0;
    const maxSeenTimestamp = records.reduce((max, entry) => {
      const ts = Number(entry.created_timestamp ?? entry.create_date ?? 0);
      return Number.isFinite(ts) ? Math.max(max, ts) : max;
    }, priorMax);
    return {
      records,
      responseCount: count,
      nextCursor: hasMore
        ? { mode: "window", maxSeenTimestamp, offset: nextOffset }
        : { mode: "window", maxSeenTimestamp, complete: true },
      pageKey: `${this.resource}:${task.segmentStart}:${task.segmentEnd}:${task.pageOffset}`,
      ...readEtsyRateHeaders(response.headers),
    };
  }

  async persistPage(
    context: AdapterContext,
    task: SyncTask,
    page: AdapterPage<EtsyLedgerEntry>,
  ): Promise<PersistCounts> {
    const ids = page.records.map((entry) => String(entry.entry_id));
    const existingRows = ids.length
      ? await context.db
          .prepare(
            `
              SELECT entry_id FROM etsy_api_ledger_entries
              WHERE entry_id IN (
                SELECT CAST(value AS TEXT) FROM json_each(?)
              )
            `,
          )
          .bind(JSON.stringify(ids))
          .all<{ entry_id: string }>()
      : { results: [] };
    const existing = new Set((existingRows.results ?? []).map((row) => row.entry_id));
    const records = page.records.map((entry) => ({
      entryId: String(entry.entry_id),
      shopId: task.shopId,
      ledgerId: entry.ledger_id == null ? null : String(entry.ledger_id),
      sequenceNumber: entry.sequence_number ?? null,
      amount: entry.amount ?? null,
      currency: entry.currency ?? null,
      description: entry.description ?? null,
      balance: entry.balance ?? null,
      createTimestamp: entry.created_timestamp ?? entry.create_date ?? null,
      ledgerType: entry.ledger_type ?? null,
      referenceType: entry.reference_type ?? null,
      referenceId:
        entry.reference_id == null ? null : String(entry.reference_id),
      parentEntryId:
        entry.parent_entry_id == null ? null : String(entry.parent_entry_id),
      paymentAdjustments: entry.payment_adjustments ?? [],
    }));
    if (records.length) {
      await context.db
        .prepare(
          `
            INSERT INTO etsy_api_ledger_entries (
              entry_id, shop_id, ledger_id, sequence_number, amount, currency,
              description, balance, create_timestamp, ledger_type, reference_type,
              reference_id, parent_entry_id, payment_adjustments_json, synced_at
            )
            SELECT
              json_extract(value,'$.entryId'), json_extract(value,'$.shopId'),
              json_extract(value,'$.ledgerId'), json_extract(value,'$.sequenceNumber'),
              json_extract(value,'$.amount'), json_extract(value,'$.currency'),
              json_extract(value,'$.description'), json_extract(value,'$.balance'),
              json_extract(value,'$.createTimestamp'), json_extract(value,'$.ledgerType'),
              json_extract(value,'$.referenceType'), json_extract(value,'$.referenceId'),
              json_extract(value,'$.parentEntryId'),
              json(json_extract(value,'$.paymentAdjustments')), CURRENT_TIMESTAMP
            FROM json_each(?) WHERE 1
            ON CONFLICT(entry_id) DO UPDATE SET
              shop_id=excluded.shop_id, ledger_id=excluded.ledger_id,
              sequence_number=excluded.sequence_number, amount=excluded.amount,
              currency=excluded.currency, description=excluded.description,
              balance=excluded.balance, create_timestamp=excluded.create_timestamp,
              ledger_type=excluded.ledger_type, reference_type=excluded.reference_type,
              reference_id=excluded.reference_id,
              parent_entry_id=excluded.parent_entry_id,
              payment_adjustments_json=excluded.payment_adjustments_json,
              synced_at=CURRENT_TIMESTAMP
          `,
        )
        .bind(JSON.stringify(records))
        .run();
    }
    const inserted = ids.filter((id) => !existing.has(id)).length;
    return {
      source: ids.length,
      fetched: ids.length,
      inserted,
      updated: ids.length - inserted,
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

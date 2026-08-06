import type { ShopEventInput } from "./_validation";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

type ShopEventRow = {
  id: number;
  event_date: string;
  event_type: string;
  listing_id: string | null;
  old_value_json: string | null;
  new_value_json: string | null;
  discount_rate: number | null;
  date_from: string | null;
  date_to: string | null;
  note: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type ShopEventRecord = {
  id: number;
  eventDate: string;
  eventType: string;
  listingId: string | null;
  oldValue: string | null;
  newValue: string | null;
  discountRate: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  note: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: ShopEventRow): ShopEventRecord {
  return {
    id: row.id,
    eventDate: row.event_date,
    eventType: row.event_type,
    listingId: row.listing_id,
    oldValue: row.old_value_json,
    newValue: row.new_value_json,
    discountRate: row.discount_rate,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    note: row.note,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadShopEvents(
  db: D1Database,
  filters: {
    listingId?: string;
    eventType?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<ShopEventRecord[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters.listingId) {
    conditions.push("listing_id = ?");
    bindings.push(filters.listingId);
  }
  if (filters.eventType) {
    conditions.push("event_type = ?");
    bindings.push(filters.eventType);
  }
  if (filters.dateFrom) {
    conditions.push("event_date >= ?");
    bindings.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push("event_date <= ?");
    bindings.push(filters.dateTo);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db
    .prepare(
      `SELECT * FROM shop_events ${whereSql} ORDER BY event_date DESC, id DESC`,
    )
    .bind(...bindings)
    .all<ShopEventRow>();

  return (result.results ?? []).map(mapRow);
}

export async function createShopEvent(
  db: D1Database,
  input: ShopEventInput,
  source: string,
): Promise<ShopEventRecord> {
  const insert = await db
    .prepare(
      `
        INSERT INTO shop_events (
          event_date, event_type, listing_id, old_value_json, new_value_json,
          discount_rate, date_from, date_to, note, source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.eventDate,
      input.eventType,
      input.listingId,
      input.oldValue,
      input.newValue,
      input.discountRate,
      input.dateFrom,
      input.dateTo,
      input.note,
      source,
    )
    .run();

  const id = insert.meta?.last_row_id;
  if (!id) {
    throw new Error("Failed to create shop event.");
  }

  const saved = await db.prepare("SELECT * FROM shop_events WHERE id = ?").bind(id).first<ShopEventRow>();
  return mapRow(saved!);
}

export async function updateShopEvent(
  db: D1Database,
  id: number,
  input: ShopEventInput,
): Promise<ShopEventRecord | null> {
  await db
    .prepare(
      `
        UPDATE shop_events SET
          event_date = ?, event_type = ?, listing_id = ?, old_value_json = ?,
          new_value_json = ?, discount_rate = ?, date_from = ?, date_to = ?,
          note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    )
    .bind(
      input.eventDate,
      input.eventType,
      input.listingId,
      input.oldValue,
      input.newValue,
      input.discountRate,
      input.dateFrom,
      input.dateTo,
      input.note,
      id,
    )
    .run();

  const saved = await db.prepare("SELECT * FROM shop_events WHERE id = ?").bind(id).first<ShopEventRow>();
  return saved ? mapRow(saved) : null;
}

export async function deleteShopEvent(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM shop_events WHERE id = ?").bind(id).run();
}

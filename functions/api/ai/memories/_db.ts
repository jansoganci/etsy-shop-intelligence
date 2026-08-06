import type { MemoryInput, MemoryType } from "./_validation";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

type MemoryRow = {
  id: number;
  memory_type: string;
  content: string;
  importance: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type MemoryRecord = {
  id: number;
  memoryType: string;
  content: string;
  importance: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    memoryType: row.memory_type,
    content: row.content,
    importance: row.importance,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadMemories(
  db: D1Database,
  filters: { memoryType?: MemoryType; keyword?: string; limit?: number } = {},
): Promise<MemoryRecord[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters.memoryType) {
    conditions.push("memory_type = ?");
    bindings.push(filters.memoryType);
  }
  if (filters.keyword) {
    conditions.push("content LIKE ?");
    bindings.push(`%${filters.keyword}%`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 100;
  bindings.push(limit);

  const result = await db
    .prepare(`SELECT * FROM ai_memories ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .bind(...bindings)
    .all<MemoryRow>();

  return (result.results ?? []).map(mapRow);
}

export async function getMemory(db: D1Database, id: number): Promise<MemoryRecord | null> {
  const row = await db.prepare("SELECT * FROM ai_memories WHERE id = ?").bind(id).first<MemoryRow>();
  return row ? mapRow(row) : null;
}

export async function createMemory(
  db: D1Database,
  input: MemoryInput,
  source: "user" | "ai",
): Promise<MemoryRecord> {
  const insert = await db
    .prepare(
      `INSERT INTO ai_memories (memory_type, content, importance, source) VALUES (?, ?, ?, ?)`,
    )
    .bind(input.memoryType, input.content, input.importance, source)
    .run();

  const id = insert.meta?.last_row_id;
  if (!id) {
    throw new Error("Failed to create memory.");
  }

  const saved = await getMemory(db, id);
  return saved!;
}

export async function updateMemory(
  db: D1Database,
  id: number,
  input: MemoryInput,
): Promise<MemoryRecord | null> {
  await db
    .prepare(
      `UPDATE ai_memories SET memory_type = ?, content = ?, importance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(input.memoryType, input.content, input.importance, id)
    .run();

  return getMemory(db, id);
}

export async function deleteMemory(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM ai_memories WHERE id = ?").bind(id).run();
}

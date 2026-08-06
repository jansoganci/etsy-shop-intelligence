-- Migration number: 0023
-- AI Analyst memory: short, durable facts (goals, preferences, decisions,
-- experiments, results, things to avoid suggesting, shop facts) that persist
-- across chat sessions. Created only via explicit user command (chat or the
-- Memory panel form) or the manual "Not Ekle" form -- never automatically.
-- Updates overwrite the existing row in place; there is no soft-delete or
-- supersede layer, so deletion is always permanent.

CREATE TABLE IF NOT EXISTS ai_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_type TEXT NOT NULL CHECK (
    memory_type IN (
      'goal', 'preference', 'decision', 'experiment',
      'result', 'avoid_suggestion', 'shop_info'
    )
  ),
  content TEXT NOT NULL,
  importance TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'ai')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_type
  ON ai_memories(memory_type, updated_at DESC);

-- Migration number: 0008
-- Phase 4: AI Analyst usage logging (no prompt/message content is stored).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL CHECK (model IN ('deepseek-v4-pro', 'deepseek-v4-flash')),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'rate_limited')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at
  ON ai_usage_logs(created_at DESC);

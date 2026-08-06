-- Migration number: 0017
-- Support asynchronous CSV import processing: widen the imports.status CHECK
-- constraint to include the in-flight stages ('importing', 'processing') and
-- add columns to record the detected import date range. SQLite cannot alter
-- a CHECK constraint in place, so the table is rebuilt and rows are copied
-- across with their original ids preserved (FK columns in payments/orders/
-- order_items reference imports(id) and are left untouched).
--
-- D1 runs each migration inside an implicit transaction, where
-- "PRAGMA foreign_keys=OFF" is silently ignored, so the rebuild has to keep
-- foreign keys satisfied instead of disabling them. Rows are staged in a
-- detached copy and re-inserted only after the new table exists, so the
-- deferred foreign key checks resolve before the transaction commits.

PRAGMA defer_foreign_keys=ON;

CREATE TABLE imports_backup AS SELECT * FROM imports;

DROP TABLE imports;

CREATE TABLE imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type TEXT NOT NULL CHECK (import_type IN ('payments', 'orders', 'order_items')),
  file_name TEXT,
  file_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'importing', 'processing', 'completed', 'failed', 'partial')
  ),
  error_message TEXT,
  detected_type TEXT,
  declared_type TEXT,
  inserted_count INTEGER,
  replaced_count INTEGER,
  skipped_count INTEGER,
  error_count INTEGER,
  started_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  failure_reason TEXT,
  date_range_start TEXT,
  date_range_end TEXT
);

INSERT INTO imports (
  id, import_type, file_name, file_hash, row_count, imported_at, status, error_message,
  detected_type, declared_type, inserted_count, replaced_count, skipped_count, error_count,
  started_at, completed_at, failed_at, failure_reason, date_range_start, date_range_end
)
SELECT
  id, import_type, file_name, file_hash, row_count, imported_at, status, error_message,
  detected_type, declared_type, inserted_count, replaced_count, skipped_count, error_count,
  started_at, completed_at, failed_at, failure_reason, NULL, NULL
FROM imports_backup;

DROP TABLE imports_backup;

CREATE INDEX IF NOT EXISTS idx_imports_file_hash ON imports(file_hash);
CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);
CREATE INDEX IF NOT EXISTS idx_imports_started_at ON imports(started_at);
CREATE INDEX IF NOT EXISTS idx_imports_completed_file_hash_type
  ON imports(import_type, file_hash, status);

-- Completed-duplicate detection (unchanged behavior).
CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_completed_file_hash_type_unique
  ON imports(import_type, file_hash)
  WHERE status = 'completed'
    AND file_hash IS NOT NULL
    AND TRIM(file_hash) <> '';

-- Belt-and-suspenders guard against two concurrent submissions of the same
-- file racing past the application-level in-progress check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_active_file_hash_type_unique
  ON imports(import_type, file_hash)
  WHERE status IN ('pending', 'importing', 'processing')
    AND file_hash IS NOT NULL
    AND TRIM(file_hash) <> '';

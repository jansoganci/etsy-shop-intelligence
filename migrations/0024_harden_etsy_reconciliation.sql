-- Reconciliation source-consistency and field-level financial issues.

ALTER TABLE etsy_reconciliation_runs ADD COLUMN source_snapshot_json TEXT;

ALTER TABLE etsy_reconciliation_issues ADD COLUMN status TEXT;
ALTER TABLE etsy_reconciliation_issues ADD COLUMN field_name TEXT;
ALTER TABLE etsy_reconciliation_issues ADD COLUMN entity_record_id TEXT;
ALTER TABLE etsy_reconciliation_issues ADD COLUMN api_value REAL;
ALTER TABLE etsy_reconciliation_issues ADD COLUMN csv_value REAL;
ALTER TABLE etsy_reconciliation_issues ADD COLUMN difference REAL;

CREATE INDEX IF NOT EXISTS idx_etsy_reconciliation_issues_filter
  ON etsy_reconciliation_issues(
    reconciliation_run_id, entity, issue_type, status, reason_code
  );

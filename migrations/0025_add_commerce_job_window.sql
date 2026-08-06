-- Migration number: 0025
-- Phase 1 Commerce Sync safety groundwork.
-- Additive only. Three nullable/defaulted columns on etsy_sync_jobs.
-- No rebuild, no data rewrite, no DROP.
--
-- etsy_sync_jobs.requested_resource has NO CHECK constraint
-- (migrations/0015_create_generic_etsy_sync_engine.sql:13), so storing
-- 'commerce' later needs no schema change here.
--
-- Existing rows default to is_period_run = 0, so watermark isolation stays
-- inert until Phase 3 creates period jobs.

ALTER TABLE etsy_sync_jobs ADD COLUMN period_from_ts INTEGER;   -- inclusive, UTC epoch seconds
ALTER TABLE etsy_sync_jobs ADD COLUMN period_to_ts   INTEGER;   -- EXCLUSIVE, UTC epoch seconds
ALTER TABLE etsy_sync_jobs ADD COLUMN is_period_run  INTEGER NOT NULL DEFAULT 0;

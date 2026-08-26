-- Tracks the `d` (date) of the last google_health_weight row successfully
-- pushed to the owner's Google Sheet via the in-app sync button
-- (api/sheets/sync.ts). Separate column from sheet_sync_checkpoint (which
-- tracks sessions by created_at) since weight rows are keyed by date, not a
-- timestamp, and sync independently of session exports. Run once in
-- Supabase's SQL editor, same as profiles_add_sheet_sync_checkpoint.sql.

alter table public.profiles
  add column if not exists weight_sheet_sync_checkpoint text;

-- Tracks the `d` (date) of the last google_health_recovery row successfully
-- pushed to the owner's Google Sheet — same shape as
-- weight_sheet_sync_checkpoint, its own column since recovery syncs
-- independently.

alter table public.profiles
  add column if not exists recovery_sheet_sync_checkpoint text;

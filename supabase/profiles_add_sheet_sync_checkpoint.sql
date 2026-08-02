-- Tracks the created_at of the last PROGRAM session successfully pushed to
-- the owner's Google Sheet via the in-app sync button (api/sheets/sync.ts).
-- Mirrors scripts/exportSessionsToSheet.mjs's own checkpoint, which uses a
-- local JSON file — not viable for an Edge Function, since there's no
-- persistent filesystem across invocations. Run once in Supabase's SQL
-- editor, same as chat_logs_add_thinking_column.sql.

alter table public.profiles
  add column if not exists sheet_sync_checkpoint timestamptz;

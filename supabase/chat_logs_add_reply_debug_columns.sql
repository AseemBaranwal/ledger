-- Adds observability that chat_logs was missing: the actual reply text and
-- the model's stop_reason for the call, on EVERY call (success, silent
-- empty reply, or error) — not just token counts and a generic error
-- string. Without this, a call that "succeeded" with an empty reply (e.g.
-- hitting max_tokens mid-reasoning before any text block was emitted) left
-- zero trace to debug from — error was null, reply text wasn't logged
-- anywhere at all. Run once in Supabase's SQL editor, same as chat_logs.sql.

alter table public.chat_logs
  add column if not exists stop_reason text,
  add column if not exists reply text;

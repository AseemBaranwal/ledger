-- Logs the model's intermediate reasoning (summarized, not raw chain-of-
-- thought) on every call, across every tool-loop iteration. Costs nothing
-- extra to capture — Anthropic bills thinking tokens the same regardless of
-- the `display` setting on the request; `summarized` just makes them
-- readable instead of returning an empty string. Run once in Supabase's
-- SQL editor, same as chat_logs.sql.

alter table public.chat_logs
  add column if not exists thinking text;

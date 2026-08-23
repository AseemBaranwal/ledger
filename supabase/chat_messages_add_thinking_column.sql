-- Persists the model's intermediate reasoning alongside the reply it
-- belongs to, so the Coach tab's thinking block survives a page reload
-- (loadHistory() re-fetches from this table on every tab mount, replacing
-- whatever the client had in memory) instead of only lasting for the
-- current in-flight turn. Mirrors chat_logs_add_thinking_column.sql's
-- reasoning — same content, different purpose: chat_logs is metrics/
-- debugging, this is what the UI actually displays back to the owner. Run
-- once in Supabase's SQL editor, same as chat_messages.sql.

alter table public.chat_messages
  add column if not exists thinking text;

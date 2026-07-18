-- LEDGER — AI coach chat logging + rate limiting
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor, same as profiles.sql / strava.sql.
--
-- Append-only. Written only by /api/chat/* via the service_role key.
-- Rate limiting (daily + short-window) is derived by COUNT(*)-ing this
-- table directly rather than maintaining a separate counter table.

create table if not exists public.chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_creation_tokens int,
  tool_calls jsonb,
  latency_ms int,
  error text
);

create index if not exists chat_logs_user_created_idx
  on public.chat_logs (user_id, created_at);

alter table public.chat_logs enable row level security;

create policy "chat_logs_select_own" on public.chat_logs
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for anon/authenticated — only the
-- service_role key (used exclusively by the Vercel API functions) can
-- write here, same pattern as strava_connections.

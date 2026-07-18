-- LEDGER — AI coach chat message history
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor, same as profiles.sql / strava.sql
-- / chat_logs.sql. Distinct from chat_logs (which holds per-call metrics —
-- token counts, latency, rate-limit accounting) — this table holds the
-- actual conversation content, so the coach has continuity across page
-- reloads and across devices (phone + laptop share one conversation).
--
-- Written only by /api/chat/message via the service_role key, right after
-- a turn completes successfully. `id` is a bigint identity rather than a
-- uuid specifically so message order can be recovered with `order by id`
-- even when two rows share the same millisecond-resolution created_at (the
-- user+assistant pair from one turn are inserted back-to-back).

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  suggestions jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_id_idx
  on public.chat_messages (user_id, id);

alter table public.chat_messages enable row level security;

create policy "chat_messages_select_own" on public.chat_messages
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for anon/authenticated — only the
-- service_role key (used exclusively by the Vercel API functions) can
-- write here, same pattern as strava_connections and chat_logs.

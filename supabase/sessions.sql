-- LEDGER — Session storage (Supabase)
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor, same as profiles.sql.
--
-- One row per logged session (PROGRAM or REST). Written directly by the
-- client under the signed-in user's own RLS-scoped session — no server
-- proxy needed, since this is benign per-user fitness data, not a
-- security-sensitive write (contrast with chat_logs/chat_messages/
-- strava_connections, which are service-role-only by design — see those
-- files for why). Replaces the Google Sheet as the source of truth for
-- workout history — a new user no longer needs to set up a Sheet or
-- Apps Script deployment before they can log anything.

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  d text not null,      -- date, YYYY-MM-DD
  s text,                -- session code (LA, PU, PL, REST_1, ...)
  g text,                -- gym / location
  ex jsonb,              -- Exercise[] — PROGRAM sessions only
  n text,                -- notes
  type text,             -- 'PROGRAM' | 'REST'
  t text,                -- title — REST sessions only
  items jsonb,           -- RestItem[] — REST sessions only
  st timestamptz,        -- session start
  et timestamptz,        -- session end
  tz int,                -- Date.getTimezoneOffset() at session start
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_date_idx
  on public.sessions (user_id, d);

alter table public.sessions enable row level security;

create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() = user_id);

create policy "sessions_insert_own" on public.sessions
  for insert with check (auth.uid() = user_id);

create policy "sessions_update_own" on public.sessions
  for update using (auth.uid() = user_id);

create policy "sessions_delete_own" on public.sessions
  for delete using (auth.uid() = user_id);

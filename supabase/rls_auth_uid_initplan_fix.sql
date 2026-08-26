-- LEDGER — RLS auth.uid() initplan fix
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor (or `npx supabase db query --linked
-- -f supabase/rls_auth_uid_initplan_fix.sql`), after the tables it touches
-- already exist. Safe to re-run — every policy is dropped and recreated.
--
-- Every existing policy compares a column to the bare call `auth.uid()`.
-- Postgres can only cache a function call as a per-query InitPlan (evaluated
-- once) when it's wrapped as a scalar subquery — the bare form is
-- re-invoked for every row the planner considers, which defeats
-- index-only evaluation on the tables hit on nearly every authenticated
-- request (`sessions` on every page load, `profiles` on every substitution
-- read/write). This is Postgres/Supabase's documented "auth_rls_initplan"
-- pattern: wrapping the call as `(select auth.uid())` lets the planner
-- evaluate it once per statement instead of once per row. Semantics are
-- unchanged — only the query plan improves.

-- sessions (supabase/sessions.sql)
drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own" on public.sessions
  for select using ((select auth.uid()) = user_id);

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own" on public.sessions
  for update using ((select auth.uid()) = user_id);

drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own" on public.sessions
  for delete using ((select auth.uid()) = user_id);

-- profiles (supabase/profiles.sql)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = id);

-- strava_connections (supabase/strava.sql) — select-only for
-- anon/authenticated, all writes go through the service_role key.
drop policy if exists "strava_select_own" on public.strava_connections;
create policy "strava_select_own" on public.strava_connections
  for select using ((select auth.uid()) = user_id);

-- chat_logs (supabase/chat_logs.sql) — select-only, same reasoning.
drop policy if exists "chat_logs_select_own" on public.chat_logs;
create policy "chat_logs_select_own" on public.chat_logs
  for select using ((select auth.uid()) = user_id);

-- chat_messages (supabase/chat_messages.sql) — select-only, same reasoning.
drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own" on public.chat_messages
  for select using ((select auth.uid()) = user_id);

-- LEDGER — targeted indexes for actual query patterns
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor (or `npx supabase db query --linked
-- -f supabase/perf_indexes.sql`), after sessions.sql and client_errors.sql
-- already exist. Idempotent — every statement uses IF NOT EXISTS, safe to
-- re-run.

-- `sessions` only had (user_id, d). Every real caller of the Coach's
-- get_training_data (api/_lib/chatTools.ts) and the Sheet-sync endpoint
-- (api/sheets/sync.ts) additionally filters `type = 'PROGRAM'` — and
-- sheets/sync.ts orders by created_at, which had no index at all, forcing
-- an explicit sort on every sync. Partial indexes scoped to type='PROGRAM'
-- are both smaller than a full-table index and a closer match to how these
-- columns are actually queried.
create index if not exists sessions_program_user_d_idx
  on public.sessions (user_id, d)
  where type = 'PROGRAM';

create index if not exists sessions_program_user_created_idx
  on public.sessions (user_id, created_at)
  where type = 'PROGRAM';

-- client_errors.user_id (supabase/client_errors.sql) is a foreign key with
-- no index — deleting/updating an auth.users row would force a full
-- sequential scan of client_errors to resolve the "on delete set null"
-- action. Cheap to add now, before this table has real accumulated rows.
create index if not exists client_errors_user_id_idx
  on public.client_errors (user_id);

-- `type` is filtered to 'PROGRAM'/'REST' everywhere (get_training_data,
-- sheets/sync.ts, sessionStore.ts) but had no constraint enforcing that —
-- unlike chat_messages.role, which already does this (see chat_messages.sql)
-- — so a typo'd insert could silently produce rows that fall out of every
-- .eq('type', 'PROGRAM') filter in the app. Verify first with
-- `select distinct type from sessions` if this has ever run against a
-- populated table; every insert path in this codebase (sessionsApi.ts) only
-- ever writes 'PROGRAM' or 'REST', so a clean table is expected.
alter table public.sessions
  add constraint sessions_type_check check (type in ('PROGRAM', 'REST')) not valid;

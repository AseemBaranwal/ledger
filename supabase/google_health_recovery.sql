-- LEDGER — persisted recovery history from Google Health
-- ────────────────────────────────────────────────────────────────
-- Run once: npx supabase db query --linked -f supabase/google_health_recovery.sql
--
-- Mirrors google_health_weight.sql's reasoning, with one important
-- difference: this table is NOT the Coach's source of truth. The Coach's
-- get_recovery_data tool still fetches live from Google on every call —
-- deliberately, since a training decision ("should I push hard today")
-- benefits from the freshest possible reading, and recoveryData.ts's
-- comparison-against-baseline logic already needs the live days array in
-- memory regardless. This table exists purely as a side-effect cache (see
-- getRecoveryData()'s upsert) for two consumers that don't need Coach-grade
-- freshness: the Trends tab's Recovery domain (RHR/HRV/sleep are daily
-- aggregates — refetching live on every tab visit just re-reads the same
-- number) and the Sheet export, which needs actual rows to read
-- incrementally the same way it reads sessions and weight.
--
-- Same posture as google_health_weight: only server code (service_role,
-- via the upsert in api/_lib/recoveryData.ts) ever writes here; a
-- select-own RLS policy lets the client read it directly for a fast cache
-- check before deciding whether a live refresh is actually needed.

create table if not exists public.google_health_recovery (
  user_id uuid not null references auth.users(id) on delete cascade,
  d text not null,                    -- civil date, YYYY-MM-DD (matches sessions.d)
  resting_heart_rate numeric,         -- bpm, nullable — a night can be missing any one metric
  hrv_ms numeric,
  sleep_minutes numeric,
  sleep_quality_index numeric,        -- Ledger's own estimate, see recoveryData.ts
  synced_at timestamptz not null default now(),
  primary key (user_id, d)
);

alter table public.google_health_recovery enable row level security;

drop policy if exists "google_health_recovery_select_own" on public.google_health_recovery;
create policy "google_health_recovery_select_own" on public.google_health_recovery
  for select using ((select auth.uid()) = user_id);

-- No insert/update/delete policy for authenticated on purpose — only the
-- service_role key writes here.

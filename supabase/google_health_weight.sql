-- LEDGER — persisted body-weight history from Google Health
-- ────────────────────────────────────────────────────────────────
-- Run once: npx supabase db query --linked -f supabase/google_health_weight.sql
--
-- Unlike recovery data (resting HR/HRV/sleep — see api/_lib/recoveryData.ts),
-- which is fetched live from Google on every Coach call and never stored,
-- weight is deliberately persisted here. Two reasons a live-only fetch isn't
-- enough for this metric specifically: (1) the Sheet export needs actual
-- historical rows to read incrementally, the same way it reads sessions from
-- the `sessions` table — there's nothing to export if nothing is ever
-- stored; (2) a body-weight trend is inherently something worth keeping a
-- durable local record of, not just a live snapshot.
--
-- Same posture as google_health_connections: only server code (the
-- service_role key, via api/_lib/bodyWeightData.ts's fetch-and-upsert) ever
-- writes here — a client-side row could silently disagree with what Google
-- actually reported. RLS still grants a select-own policy so the client can
-- read it directly for the Trends tab's chart, same shape as how the client
-- reads sessions directly rather than going through a server proxy for a
-- benign per-user read.

create table if not exists public.google_health_weight (
  user_id uuid not null references auth.users(id) on delete cascade,
  d text not null,              -- civil date, YYYY-MM-DD (matches sessions.d)
  weight_lb numeric not null,   -- always lb — see src/services/units.ts's
                                 -- "stored in lb everywhere" convention
  synced_at timestamptz not null default now(),
  primary key (user_id, d)
);

alter table public.google_health_weight enable row level security;

-- auth.uid() wrapped as a scalar subquery — see
-- supabase/rls_auth_uid_initplan_fix.sql for why (Postgres only caches it as
-- a per-query InitPlan in this form, not called bare).
drop policy if exists "google_health_weight_select_own" on public.google_health_weight;
create policy "google_health_weight_select_own" on public.google_health_weight
  for select using ((select auth.uid()) = user_id);

-- No insert/update/delete policy for authenticated on purpose — only the
-- service_role key (the server-side Google Health fetch) writes here.

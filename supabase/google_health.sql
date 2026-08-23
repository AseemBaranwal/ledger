-- LEDGER — Google Health connection storage
-- ────────────────────────────────────────────────────────────────
-- Run once: npx supabase db query --linked -f supabase/google_health.sql
--
-- Same security posture as strava_connections: tokens are only ever
-- written/read by the Vercel serverless functions in /api/google-health/*
-- using the service_role key (server-side only, never shipped to the
-- browser). The client never sees a Google access_token or refresh_token.
-- RLS still exists so that if this table were ever queried with a user's
-- own session rather than the service_role key, they could only ever see
-- their own row.
--
-- NOTE ON EXPIRY (see issue #59): while this app's Google OAuth consent
-- screen is in "Testing" publishing status, Google force-expires refresh
-- tokens after 7 days. That is an EXPECTED state here, not a failure —
-- `refresh_failed_at` records when a refresh was rejected so the UI can
-- prompt a reconnect instead of silently showing stale/no data.

create table if not exists public.google_health_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  -- unix seconds. Google returns expires_in (relative); the exchange
  -- endpoint converts it to an absolute instant before storing.
  expires_at bigint not null,
  scopes text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when a refresh attempt is rejected (the 7-day expiry above, or a
  -- user revoking access in their Google account). Cleared on every
  -- successful reconnect/refresh.
  refresh_failed_at timestamptz
);

alter table public.google_health_connections enable row level security;

create policy "google_health_select_own" on public.google_health_connections
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for anon/authenticated on purpose —
-- only the service_role key can write here. Disconnecting also goes
-- through the API, so the same rule applies there.

create or replace function public.set_google_health_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists google_health_set_updated_at on public.google_health_connections;
create trigger google_health_set_updated_at
  before update on public.google_health_connections
  for each row execute procedure public.set_google_health_updated_at();

-- LEDGER — Strava connection storage
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor, same as profiles.sql.
--
-- Tokens here are only ever written/read by the Vercel serverless
-- functions in /api/strava/*, using the service_role key (server-side
-- only, never shipped to the browser) — the client never sees or
-- handles a Strava access_token or refresh_token directly. RLS still
-- exists so that if this table were ever queried with a user's own
-- session (not the service_role key), they could only see their own
-- connection row, never anyone else's.

create table if not exists public.strava_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint not null,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null, -- unix seconds, from Strava's expires_at
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.strava_connections enable row level security;

create policy "strava_select_own" on public.strava_connections
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for the anon/authenticated role on
-- purpose — only the service_role key (used exclusively by the Vercel
-- API functions) can write to this table. A user disconnecting Strava
-- goes through the API too, so the same rule applies there.

create or replace function public.set_strava_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strava_connections_set_updated_at on public.strava_connections;
create trigger strava_connections_set_updated_at
  before update on public.strava_connections
  for each row execute procedure public.set_strava_updated_at();

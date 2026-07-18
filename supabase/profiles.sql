-- LEDGER — Supabase setup
-- ────────────────────────────────────────────────────────────────
-- Run this once in your Supabase project's SQL editor (Dashboard →
-- SQL Editor → New query → paste this whole file → Run).
--
-- This does NOT store your workout data — that still lives in your
-- personal Google Sheet, exactly as before. This table only maps a
-- signed-in Google account to which Sheet (and later, which routine)
-- belongs to them, so "sign in with Google" can find the right data.
--
-- Before running this:
--  1. Authentication → Providers → enable Google (needs a Google OAuth
--     Client ID + Secret from Google Cloud Console — Supabase's docs
--     link directly to the right page for this).
--  2. Authentication → URL Configuration → add your app's URL (and
--     http://localhost:5173 for local dev) to the allowed redirect URLs.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  sheet_url text,
  routine_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Each user can only ever see or touch their own row.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- Auto-create a (mostly empty) profile row the moment someone signs in for
-- the first time, so the client can always assume the row exists and just
-- needs sheet_url filled in (via upsert, so it's safe even if this trigger
-- didn't fire yet for some reason).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keep updated_at current on every change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

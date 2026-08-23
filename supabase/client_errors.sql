-- LEDGER — client-side crash/error logging
-- ────────────────────────────────────────────────────────────────
-- Run this once in Supabase's SQL editor, same as chat_logs.sql / strava.sql.
--
-- Append-only, best-effort. Written only by /api/log-error via the
-- service_role key, fed from window.onerror/unhandledrejection and the
-- top-level React error boundary (see issue #58) — previously a crash was
-- completely invisible: no way to know it happened, how often, or on what
-- device, beyond guessing from reading the code.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null, -- nullable: a crash can happen before sign-in resolves
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  source text, -- 'window.onerror' | 'unhandledrejection' | 'error_boundary'
  url text,
  user_agent text
);

create index if not exists client_errors_created_idx
  on public.client_errors (created_at);

alter table public.client_errors enable row level security;

-- No select/insert/update/delete policies for anon/authenticated — this is
-- diagnostic data about the app itself, not something any client needs to
-- read back; only the service_role key (used exclusively by
-- api/log-error.ts) can write here, same pattern as chat_logs/
-- strava_connections.

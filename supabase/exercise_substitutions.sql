-- Run this once in Supabase's SQL editor, same as profiles.sql / chat_logs.sql
-- / chat_messages.sql. Adds a column to the existing profiles table rather
-- than a new table — exercise substitutions are a per-user setting (like
-- sheet_url), not an append-only log, so they fit the same row sign-in
-- already creates.
--
-- Keyed by the ORIGINAL exercise code -> the exercise it's currently
-- substituted with ({code, name, group, unit}). Checked at session-start
-- time (see TodayTab.tsx's handleStart) so an accepted Coach swap takes
-- effect from the next time that exercise comes up in the program — not
-- just the one session that happened to be open when it was accepted — and
-- is also applied immediately to a live draft if one's open right now.

alter table public.profiles
  add column if not exists exercise_substitutions jsonb not null default '{}'::jsonb;

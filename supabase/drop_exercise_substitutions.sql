-- Run once via `npx supabase db query --linked -f supabase/drop_exercise_substitutions.sql`.
-- exercise_substitutions (added by the now-removed supabase/exercise_substitutions.sql)
-- was a redirect table keyed by the original exercise code -> its
-- currently-swapped-in replacement. It's fully retired: every exercise
-- code is now the real Strava exercise_type constant, stored directly in
-- profiles.routine_config.program, with no redirect layer. See CLAUDE.md's
-- "Exercise codes are the Strava exercise_type, everywhere, always"
-- section. Nothing in the codebase reads or writes this column anymore.

alter table public.profiles
  drop column if exists exercise_substitutions;

import { supabase } from './supabaseClient'
import { getCurrentUserId } from './userScope'

export interface ExerciseSubstitution {
  code: string
  name: string
  group: string
  unit: string
}

// Standing exercise substitutions (original program code -> replacement)
// live on profiles.exercise_substitutions — a per-user setting like
// routine_config, read/written directly by the client via RLS
// (auth.uid() = user_id). Checked at session-start time (see
// TodayTab.tsx's handleStart) so a swap sticks for every future occurrence
// of that exercise, not just the session it was made in.
//
// This is deliberately separate from the Coach's own write path
// (api/chat/apply-exercise-swap.ts), which stays owner-gated because it's
// tied to the Coach's suggestion-accept flow — but a manual swap from the
// in-session picker is a general feature everyone gets, so it writes here
// directly instead of through that owner-only endpoint.
export async function fetchSubstitutions(userId: string): Promise<Record<string, ExerciseSubstitution>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('exercise_substitutions')
    .eq('id', userId)
    .single()
  if (error) throw new Error(error.message)
  return (data?.exercise_substitutions as Record<string, ExerciseSubstitution>) || {}
}

export async function saveSubstitution(originalCode: string, replacement: ExerciseSubstitution): Promise<void> {
  const userId = getCurrentUserId()
  if (!userId) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('profiles')
    .select('exercise_substitutions')
    .eq('id', userId)
    .single()
  if (error) throw new Error(error.message)

  const substitutions = { ...((data?.exercise_substitutions as Record<string, ExerciseSubstitution>) || {}), [originalCode]: replacement }
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ exercise_substitutions: substitutions })
    .eq('id', userId)
  if (updateError) throw new Error(updateError.message)
}

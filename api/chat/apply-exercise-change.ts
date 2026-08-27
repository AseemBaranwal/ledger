import { requireUser, isOwner } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

interface ProgramExerciseLike {
  k: string
  w?: number
  r?: number
  s?: number
}

// The ONLY code path that can write an exercise's weight/reps/sets target.
// Deliberately separate from api/chat/message.ts: the chat endpoint's
// suggest_exercise_adjustment tool only ever produces a proposal, never a
// write. This endpoint takes a plain {exerciseCode, weight?, reps?, sets?}
// body from an explicit user tap on a rendered suggestion card — never raw
// LLM output — so the model itself never has write access to training
// data, only proposal access.
//
// Writes into profiles.routine_config (read-modify-write, same pattern as
// api/_lib/chatHistory.ts's updateSuggestionStatus — jsonb has no partial-
// field update in supabase-js) rather than the old Google Sheet Weights
// tab: the program and its current targets now live in one place per user.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  if (!isOwner(user.id)) {
    return new Response(JSON.stringify({ error: 'Not available for this account' }), { status: 403 })
  }

  let payload: { exerciseCode?: string; weight?: number; reps?: number; sets?: number }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { exerciseCode, weight, reps, sets } = payload
  if (!exerciseCode || (weight == null && reps == null && sets == null)) {
    return new Response(JSON.stringify({ error: 'Missing exerciseCode and at least one of weight/reps/sets' }), { status: 400 })
  }
  if (weight != null && !(weight > 0)) {
    return new Response(JSON.stringify({ error: 'weight must be positive' }), { status: 400 })
  }
  if (reps != null && !(reps > 0)) {
    return new Response(JSON.stringify({ error: 'reps must be positive' }), { status: 400 })
  }
  if (sets != null && !(sets > 0)) {
    return new Response(JSON.stringify({ error: 'sets must be positive' }), { status: 400 })
  }

  const { data: profile, error } = await supabaseAdmin()
    .from('profiles')
    .select('routine_config, exercise_substitutions')
    .eq('id', user.id)
    .single()

  const routineConfig = (profile as { routine_config?: { program?: Record<string, { ex?: ProgramExerciseLike[] }> } } | null)?.routine_config
  if (error || !routineConfig || !routineConfig.program) {
    return new Response(JSON.stringify({ error: 'No training program found for this account' }), { status: 404 })
  }

  // Try the code as given first, then fall back to resolving it as a
  // currently-SWAPPED-IN code back to the program's own original code — a
  // swap only ever writes a standing substitution (profiles.
  // exercise_substitutions), it deliberately never rewrites the program's
  // own stored code (see supabase/exercise_substitutions.sql). A caller
  // that only has visibility into the swapped-in code (e.g. the Coach's
  // get_training_data, whose rows show whatever a session was actually
  // logged under) would otherwise 404 here for any currently-swapped
  // exercise — confirmed as a real, live bug on a swapped Squat (issue #88).
  function applyTo(code: string): boolean {
    let matched = false
    for (const session of Object.values(routineConfig!.program!)) {
      for (const ex of session.ex || []) {
        if (ex.k !== code) continue
        matched = true
        if (weight != null) ex.w = weight
        if (reps != null) ex.r = reps
        if (sets != null) ex.s = sets
      }
    }
    return matched
  }

  let found = applyTo(exerciseCode)
  if (!found) {
    const substitutions = (profile as { exercise_substitutions?: Record<string, { code: string }> } | null)?.exercise_substitutions || {}
    const originalCode = Object.keys(substitutions).find((code) => substitutions[code]?.code === exerciseCode)
    if (originalCode) found = applyTo(originalCode)
  }

  if (!found) {
    return new Response(JSON.stringify({ error: `"${exerciseCode}" isn't in your current program` }), { status: 404 })
  }

  const { error: updateError } = await (supabaseAdmin().from('profiles') as any)
    .update({ routine_config: routineConfig })
    .eq('id', user.id)
  if (updateError) {
    return new Response(JSON.stringify({ error: 'Could not save the update' }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

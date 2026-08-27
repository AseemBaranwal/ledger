import { requireUser, isOwner } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

interface ProgramExerciseLike {
  k: string
  n?: string
  group?: string
  u?: string
  w?: number
  r?: number
  s?: number
}

// The ONLY code path that can write a persistent exercise swap. Distinct
// from apply-exercise-change.ts (weight/reps/sets targets on the SAME
// exercise) — this replaces which exercise a program slot resolves to.
//
// Writes directly into profiles.routine_config's own stored exercise
// entry — NOT a separate redirect table. Previously this wrote to
// profiles.exercise_substitutions (see supabase/exercise_substitutions.sql,
// now unused everywhere in this codebase — the column is left in place but
// nothing reads or writes it anymore), keyed by the original code, with
// the program's own entry left permanently stale. That split-source-of-
// truth design was the root cause of a real, live data bug (issue #89):
// a swapped exercise's PROGRAM entry (used by, among other things, the
// accept-flow for weight/reps/sets changes) never agreed with what a swap
// had actually changed it to, and there was no way to ever undo a mistaken
// swap short of another swap. Now the program's own `k`/`n`/`group`/`u`
// ARE the swap — one field to update, one thing to read, everywhere.
// weight/reps/sets are deliberately left as whatever the slot already had
// — a rough starting point for a genuinely new exercise, self-correcting
// via a real suggest_exercise_adjustment once actual data exists, same as
// today's UX for a brand new exercise added to the program.
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

  let payload: { originalCode?: string; newCode?: string; newName?: string; newGroup?: string; newUnit?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { originalCode, newCode, newName, newGroup, newUnit } = payload
  if (!originalCode || !newCode || !newName) {
    return new Response(JSON.stringify({ error: 'Missing originalCode, newCode, or newName' }), { status: 400 })
  }

  const { data: profile, error } = await supabaseAdmin()
    .from('profiles')
    .select('routine_config')
    .eq('id', user.id)
    .single()

  const routineConfig = (profile as { routine_config?: { program?: Record<string, { ex?: ProgramExerciseLike[] }> } } | null)?.routine_config
  if (error || !routineConfig || !routineConfig.program) {
    return new Response(JSON.stringify({ error: 'No training program found for this account' }), { status: 404 })
  }

  let found = false
  for (const session of Object.values(routineConfig.program)) {
    for (const ex of session.ex || []) {
      if (ex.k !== originalCode) continue
      found = true
      ex.k = newCode
      ex.n = newName
      if (newGroup) ex.group = newGroup
      if (newUnit) ex.u = newUnit
    }
  }

  if (!found) {
    return new Response(JSON.stringify({ error: `"${originalCode}" isn't in your current program` }), { status: 404 })
  }

  const { error: updateError } = await (supabaseAdmin().from('profiles') as any)
    .update({ routine_config: routineConfig })
    .eq('id', user.id)
  if (updateError) {
    return new Response(JSON.stringify({ error: 'Could not save the swap' }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

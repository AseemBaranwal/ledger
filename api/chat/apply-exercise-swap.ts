import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

function isOwner(userId: string): boolean {
  const allowList = (process.env.CHAT_OWNER_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return allowList.includes(userId)
}

// The ONLY code path that can write a persistent exercise substitution.
// Distinct from apply-exercise-change.ts (weight/reps/sets targets on the
// SAME exercise) — this replaces which exercise an occurrence resolves to,
// a completely different payload shape, so it gets its own dedicated
// write endpoint per this app's established one-endpoint-per-write-type
// pattern.
//
// Stored on profiles.exercise_substitutions (see
// supabase/exercise_substitutions.sql), keyed by the ORIGINAL exercise
// code — not a new table, since this is a per-user setting like sheet_url,
// not an append-only log. GET returns the current map so the client can
// apply it at session-start time (see TodayTab.tsx) without a dedicated
// fetch on every render.
export default async function handler(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  if (!isOwner(user.id)) {
    return new Response(JSON.stringify({ error: 'Not available for this account' }), { status: 403 })
  }

  if (req.method === 'GET') {
    const { data } = await (supabaseAdmin().from('profiles') as any)
      .select('exercise_substitutions')
      .eq('id', user.id)
      .single()
    return new Response(JSON.stringify({ substitutions: data?.exercise_substitutions || {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
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

  const { data: profile, error } = await (supabaseAdmin().from('profiles') as any)
    .select('exercise_substitutions')
    .eq('id', user.id)
    .single()
  if (error) {
    return new Response(JSON.stringify({ error: 'Could not load profile' }), { status: 500 })
  }

  const substitutions = { ...(profile?.exercise_substitutions || {}) }
  substitutions[originalCode] = { code: newCode, name: newName, group: newGroup || 'Other', unit: newUnit || 'lb' }

  const { error: updateError } = await (supabaseAdmin().from('profiles') as any)
    .update({ exercise_substitutions: substitutions })
    .eq('id', user.id)
  if (updateError) {
    return new Response(JSON.stringify({ error: 'Could not save the swap' }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true, substitutions }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

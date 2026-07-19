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

// The ONLY code path that can write an exercise's weight/reps/sets target
// into the Sheet. Deliberately separate from api/chat/message.ts: the chat
// endpoint's suggest_exercise_adjustment tool only ever produces a proposal,
// never a write. This endpoint takes a plain {exerciseCode, weight?, reps?,
// sets?} body from an explicit user tap on a rendered suggestion card —
// never raw LLM output — so the model itself never has write access to
// training data, only proposal access. (Formerly apply-weight.ts, before
// this also covered reps/sets — renamed for clarity, same endpoint shape
// otherwise.)
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
    .select('sheet_url')
    .eq('id', user.id)
    .single()

  if (error || !profile || !(profile as { sheet_url?: string }).sheet_url) {
    return new Response(JSON.stringify({ error: 'No Sheet connected for this account' }), { status: 404 })
  }
  const sheetUrl = (profile as { sheet_url: string }).sheet_url

  // Same no-cors / text-plain handling pushSession() uses in appScript.ts —
  // application/json isn't CORS-safelisted for a no-cors request, and the
  // opaque response means we can't read back real success/failure, only
  // that the request was sent. Same known limitation as every other write
  // in this app.
  try {
    await fetch(sheetUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'weight', code: exerciseCode, weight, reps, sets }),
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Could not reach the Google Sheet' }), { status: 502 })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

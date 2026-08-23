import { supabaseAdmin } from './_lib/supabaseAdmin.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

const MAX_MESSAGE_CHARS = 2000
const MAX_STACK_CHARS = 8000

// Deliberately NOT gated by requireUser()/isOwner() the way the Coach
// endpoints are — a crash can happen before sign-in even resolves (e.g.
// on SignInScreen itself), and knowing about those matters just as much
// as an authenticated one. Best-effort and fire-and-forget from the
// client (see errorReporting.ts): a broken error reporter must never
// become its own source of noise or a second thing to debug.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: { message?: string; stack?: string; source?: string; url?: string; userId?: string | null }
  try {
    payload = await req.json()
  } catch {
    // A malformed body isn't worth a 400 that might make the client retry
    // in a loop — just drop it.
    return new Response('ok', { status: 200 })
  }

  const message = String(payload.message || 'Unknown error').slice(0, MAX_MESSAGE_CHARS)
  const stack = payload.stack ? String(payload.stack).slice(0, MAX_STACK_CHARS) : null
  const source = payload.source ? String(payload.source).slice(0, 50) : null
  const url = payload.url ? String(payload.url).slice(0, 500) : null
  const userAgent = req.headers.get('user-agent')?.slice(0, 500) || null

  try {
    // See auth.ts's requireUser for why supabase-js's own auth.getUser(jwt)
    // isn't used here — this endpoint doesn't verify the caller at all
    // (see the note above), so payload.userId is just a best-effort label,
    // not a security boundary.
    await (supabaseAdmin().from('client_errors') as any).insert({
      user_id: payload.userId || null,
      message,
      stack,
      source,
      url,
      user_agent: userAgent,
    })
  } catch {
    // Logging a crash must never itself throw.
  }

  return new Response('ok', { status: 200 })
}

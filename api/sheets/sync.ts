import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// See message.ts (api/chat) for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

function isOwner(userId: string): boolean {
  const allowList = (process.env.CHAT_OWNER_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return allowList.includes(userId)
}

interface SessionRow {
  d: string
  s: string | null
  g: string | null
  ex: unknown[] | null
  n: string | null
  created_at: string
}

// Server-side counterpart to scripts/exportSessionsToSheet.mjs, triggered
// from the Sync tab instead of a manual `node scripts/...` run. Pushes
// newly-logged PROGRAM sessions into the owner's Google Sheet via its
// still-live Apps Script Web App (see CLAUDE.md's "Workout data lives in
// Supabase" section for why the app itself no longer talks to Sheets).
//
// Needs its own persisted checkpoint (profiles.sheet_sync_checkpoint) since
// the script's local-JSON-file checkpoint doesn't survive across Edge
// Function invocations — each request is a fresh, stateless instance.
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

  const scriptUrl = process.env.LEDGER_SHEET_SCRIPT_URL
  if (!scriptUrl) {
    return new Response(JSON.stringify({ error: 'Sheet sync is not configured on the server' }), { status: 501 })
  }

  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('sheet_sync_checkpoint')
    .eq('id', user.id)
    .single()
  const since = (profile as { sheet_sync_checkpoint?: string | null } | null)?.sheet_sync_checkpoint ?? null

  let query = supabaseAdmin()
    .from('sessions')
    .select('d,s,g,ex,n,created_at')
    .eq('user_id', user.id)
    .eq('type', 'PROGRAM')
    .order('created_at', { ascending: true })
  if (since) query = query.gt('created_at', since)

  const { data: sessions, error: sessionsError } = await query
  if (sessionsError) {
    return new Response(JSON.stringify({ error: 'Could not read sessions' }), { status: 500 })
  }

  const rows = (sessions || []) as unknown as SessionRow[]
  let exported = 0
  let failures = 0
  let maxCreatedAt = since

  for (const session of rows) {
    if (!session.ex?.length) continue // no exercises logged — nothing to append

    try {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'session', d: session.d, s: session.s, g: session.g, ex: session.ex, n: session.n }),
      })
      const text = await res.text()
      if (!res.ok || text.startsWith('error')) {
        failures++
        continue // don't advance the checkpoint past a row that failed
      }
      exported++
      maxCreatedAt = session.created_at
    } catch {
      failures++
    }
  }

  if (maxCreatedAt && maxCreatedAt !== since) {
    await (supabaseAdmin().from('profiles') as any).update({ sheet_sync_checkpoint: maxCreatedAt }).eq('id', user.id)
  }

  return new Response(JSON.stringify({ success: true, exported, failures }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

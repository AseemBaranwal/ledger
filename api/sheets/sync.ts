import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getBodyWeightData } from '../_lib/bodyWeightData.js'
import { getRecoveryData } from '../_lib/recoveryData.js'

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

interface WeightRow {
  d: string
  weight_lb: number
}

// Pushes newly-recorded google_health_weight rows into a "Weight" tab, same
// incremental/checkpointed shape as the session sync above — a separate
// function since it has its own checkpoint column (profiles
// .weight_sheet_sync_checkpoint) and its own POST `type`. getBodyWeightData
// is called first specifically to refresh google_health_weight with
// whatever's new since the last sync (it upserts as a side effect — see
// api/_lib/bodyWeightData.ts) before reading rows to export; skipped
// entirely, not an error, when Google Health isn't connected.
//
// NOTE: the live Apps Script Web App (not in this repo — see CLAUDE.md's
// "Workout data lives in Supabase" section) needs a `type === 'weight'` case
// added by hand to actually write these into a Sheet tab, the same one-time
// step issue #37 needed for the `type: 'targets'` case exportTargetsToSheet
// .mjs relies on.
async function syncWeightToSheet(
  userId: string,
  scriptUrl: string
): Promise<{ weightExported: number; weightFailures: number }> {
  const weightResult = await getBodyWeightData(userId, { days: 90 })
  if (weightResult.status !== 'ok') return { weightExported: 0, weightFailures: 0 }

  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('weight_sheet_sync_checkpoint')
    .eq('id', userId)
    .single()
  const since = (profile as { weight_sheet_sync_checkpoint?: string | null } | null)?.weight_sheet_sync_checkpoint ?? null

  let query = supabaseAdmin().from('google_health_weight').select('d,weight_lb').eq('user_id', userId).order('d', { ascending: true })
  if (since) query = query.gt('d', since)

  const { data: rows } = await query
  const weightRows = (rows || []) as unknown as WeightRow[]

  let weightExported = 0
  let weightFailures = 0
  let checkpoint = since

  for (const row of weightRows) {
    try {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'weight', d: row.d, weightLb: row.weight_lb }),
      })
      const text = await res.text()
      if (!res.ok || text.startsWith('error')) {
        weightFailures++
        continue
      }
      weightExported++
      checkpoint = row.d
      await (supabaseAdmin().from('profiles') as any).update({ weight_sheet_sync_checkpoint: checkpoint }).eq('id', userId)
    } catch {
      weightFailures++
    }
  }

  return { weightExported, weightFailures }
}

interface RecoveryRow {
  d: string
  resting_heart_rate: number | null
  hrv_ms: number | null
  sleep_minutes: number | null
  sleep_quality_index: number | null
}

// Same shape as syncWeightToSheet above, against google_health_recovery and
// its own recovery_sheet_sync_checkpoint column. getRecoveryData is called
// first to refresh the cache with anything new since the last sync — see
// api/_lib/recoveryData.ts's cache-check, which means this costs a live
// Google fetch only when today's reading isn't already cached, not on
// every sync run.
async function syncRecoveryToSheet(
  userId: string,
  scriptUrl: string
): Promise<{ recoveryExported: number; recoveryFailures: number }> {
  const recoveryResult = await getRecoveryData(userId, { days: 90 })
  if (recoveryResult.status !== 'ok') return { recoveryExported: 0, recoveryFailures: 0 }

  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('recovery_sheet_sync_checkpoint')
    .eq('id', userId)
    .single()
  const since = (profile as { recovery_sheet_sync_checkpoint?: string | null } | null)?.recovery_sheet_sync_checkpoint ?? null

  let query = supabaseAdmin()
    .from('google_health_recovery')
    .select('d,resting_heart_rate,hrv_ms,sleep_minutes,sleep_quality_index')
    .eq('user_id', userId)
    .order('d', { ascending: true })
  if (since) query = query.gt('d', since)

  const { data: rows } = await query
  const recoveryRows = (rows || []) as unknown as RecoveryRow[]

  let recoveryExported = 0
  let recoveryFailures = 0
  let checkpoint = since

  for (const row of recoveryRows) {
    try {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'recovery',
          d: row.d,
          restingHeartRate: row.resting_heart_rate,
          hrvMs: row.hrv_ms,
          sleepMinutes: row.sleep_minutes,
          sleepQualityIndex: row.sleep_quality_index,
        }),
      })
      const text = await res.text()
      if (!res.ok || text.startsWith('error')) {
        recoveryFailures++
        continue
      }
      recoveryExported++
      checkpoint = row.d
      await (supabaseAdmin().from('profiles') as any).update({ recovery_sheet_sync_checkpoint: checkpoint }).eq('id', userId)
    } catch {
      recoveryFailures++
    }
  }

  return { recoveryExported, recoveryFailures }
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
  let checkpoint = since

  // The checkpoint is persisted after EVERY successful row, not once at the
  // end of the loop. A batch that times out or crashes partway through a
  // large backlog (e.g. a first-ever sync of months of history) would
  // otherwise leave the checkpoint at its pre-run value — every row already
  // POSTed successfully in that run gets duplicated into the Sheet on the
  // next attempt, and a backlog that reliably exceeds the function's time
  // budget could never finish syncing since it always restarts from
  // scratch. One extra write per exported row costs little at this app's
  // real volume (a handful of sessions per sync) against the correctness
  // this buys.
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
      checkpoint = session.created_at
      await (supabaseAdmin().from('profiles') as any).update({ sheet_sync_checkpoint: checkpoint }).eq('id', user.id)
    } catch {
      failures++
    }
  }

  const { weightExported, weightFailures } = await syncWeightToSheet(user.id, scriptUrl)
  const { recoveryExported, recoveryFailures } = await syncRecoveryToSheet(user.id, scriptUrl)

  return new Response(
    JSON.stringify({ success: true, exported, failures, weightExported, weightFailures, recoveryExported, recoveryFailures }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

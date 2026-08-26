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

// Edge Functions must send their first response byte within 25s (see
// CLAUDE.md's Edge Functions section) — a real limit this handler hit in
// production once weight/recovery sync were added on top of sessions: a
// first-ever sync can have a 90-day backlog in EACH of three phases, each
// row costing its own synchronous POST to the (often slow, sometimes
// cold-starting) Apps Script Web App. A per-phase row cap would still risk
// blowing the budget if any one POST is slow; a shared wall-clock deadline
// across all three phases is what actually bounds total latency regardless
// of per-request variance. 18s leaves a real margin under the 25s hard
// limit for the sessions-read query and response serialization that still
// have to happen after the loops. Stopping early is safe and lossless: the
// exact same per-row checkpoint that already protects against a crash
// mid-batch also means an early stop just continues seamlessly on the next
// call — nothing already exported gets re-sent, nothing pending is skipped.
const SYNC_TIME_BUDGET_MS = 18000

function pastDeadline(deadline: number): boolean {
  return Date.now() >= deadline
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

// Pushes newly-recorded google_health_weight rows into the Apps Script's
// EXISTING "Body" sheet, via its EXISTING `type: 'body'` handler
// (`{d, wt, bf?, smm?, waist?, fer?}` → ensureBodySheet_()) — confirmed by
// reading the live script directly, not assumed. This deliberately does
// NOT use `type: 'weight'`: that type is already taken by a completely
// different handler in the same script (upserts an EXERCISE's target
// weight/reps/sets by `code` into the "Weights" sheet). Sending body-weight
// rows under `type: 'weight'` would have silently landed in the wrong
// sheet as a garbage row (`code: undefined`) — caught before this ever
// shipped, not after. Reusing `type: 'body'` needs zero Apps Script
// changes for weight; bf/smm/waist/fer are simply omitted, same as any
// other partial update that handler already tolerates.
async function syncWeightToSheet(
  userId: string,
  scriptUrl: string,
  deadline: number
): Promise<{ weightExported: number; weightFailures: number; weightHasMore: boolean }> {
  const weightResult = await getBodyWeightData(userId, { days: 90 })
  if (weightResult.status !== 'ok') return { weightExported: 0, weightFailures: 0, weightHasMore: false }

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
  // Once true, the checkpoint stops advancing for the rest of this run —
  // see the shared explanation on the checkpoint-advancement fix above the
  // main session loop below (issue #66): letting a LATER success overwrite
  // the checkpoint past an EARLIER failure would permanently skip that
  // failed row on every future sync, since the next query starts strictly
  // after the (now-advanced) checkpoint. Rows after a failure are still
  // attempted this run (best-effort), just don't move the persisted
  // checkpoint past the failure point.
  let sawFailure = false

  for (const row of weightRows) {
    if (pastDeadline(deadline)) return { weightExported, weightFailures, weightHasMore: true }
    try {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'body', d: row.d, wt: row.weight_lb }),
      })
      const text = await res.text()
      if (!res.ok || text.startsWith('error')) {
        weightFailures++
        sawFailure = true
        continue
      }
      weightExported++
      if (!sawFailure) {
        checkpoint = row.d
        await (supabaseAdmin().from('profiles') as any).update({ weight_sheet_sync_checkpoint: checkpoint }).eq('id', userId)
      }
    } catch {
      weightFailures++
      sawFailure = true
    }
  }

  return { weightExported, weightFailures, weightHasMore: false }
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
  scriptUrl: string,
  deadline: number
): Promise<{ recoveryExported: number; recoveryFailures: number; recoveryHasMore: boolean }> {
  const recoveryResult = await getRecoveryData(userId, { days: 90 })
  if (recoveryResult.status !== 'ok') return { recoveryExported: 0, recoveryFailures: 0, recoveryHasMore: false }

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
  // See syncWeightToSheet's identical sawFailure comment (issue #66) — same
  // fix, same reasoning, applied here too.
  let sawFailure = false

  for (const row of recoveryRows) {
    if (pastDeadline(deadline)) return { recoveryExported, recoveryFailures, recoveryHasMore: true }
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
        sawFailure = true
        continue
      }
      recoveryExported++
      if (!sawFailure) {
        checkpoint = row.d
        await (supabaseAdmin().from('profiles') as any).update({ recovery_sheet_sync_checkpoint: checkpoint }).eq('id', userId)
      }
    } catch {
      recoveryFailures++
      sawFailure = true
    }
  }

  return { recoveryExported, recoveryFailures, recoveryHasMore: false }
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
  let sessionsHasMore = false

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
  //
  // deadline is shared across sessions + weight + recovery below, not a
  // separate budget per phase — see SYNC_TIME_BUDGET_MS's comment for why a
  // wall-clock deadline (not a row-count cap) is what actually bounds this
  // Edge Function's 25s time-to-first-byte limit regardless of how slow any
  // one Apps Script POST turns out to be.
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS

  // Once true, the checkpoint stops advancing for the rest of this run
  // (issue #66) — previously a LATER success in the same batch would still
  // overwrite `checkpoint` past an EARLIER failed row, since the checkpoint
  // was just a scalar unconditionally reassigned on every success. That
  // permanently skipped the failed row: the next sync's `.gt(checkpoint)`
  // query starts strictly after the now-advanced checkpoint, so a row that
  // failed once could never be retried again. Rows after a failure are
  // still attempted this run (best-effort — a transient blip on one row
  // shouldn't block everything after it), just don't move the persisted
  // checkpoint past the failure point.
  let sawFailure = false
  for (const session of rows) {
    if (!session.ex?.length) continue // no exercises logged — nothing to append
    if (pastDeadline(deadline)) {
      sessionsHasMore = true
      break
    }

    try {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'session', d: session.d, s: session.s, g: session.g, ex: session.ex, n: session.n }),
      })
      const text = await res.text()
      if (!res.ok || text.startsWith('error')) {
        failures++
        sawFailure = true
        continue // don't advance the checkpoint past a row that failed
      }
      exported++
      if (!sawFailure) {
        checkpoint = session.created_at
        await (supabaseAdmin().from('profiles') as any).update({ sheet_sync_checkpoint: checkpoint }).eq('id', user.id)
      }
    } catch {
      failures++
      sawFailure = true
    }
  }

  const { weightExported, weightFailures, weightHasMore } = await syncWeightToSheet(user.id, scriptUrl, deadline)
  const { recoveryExported, recoveryFailures, recoveryHasMore } = await syncRecoveryToSheet(user.id, scriptUrl, deadline)
  const hasMore = sessionsHasMore || weightHasMore || recoveryHasMore

  return new Response(
    JSON.stringify({
      success: true,
      exported,
      failures,
      weightExported,
      weightFailures,
      recoveryExported,
      recoveryFailures,
      hasMore,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

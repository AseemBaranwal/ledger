import { supabase } from './supabaseClient'

// Client-safe flag only — presence of a real Sheet integration is a server
// secret (LEDGER_SHEET_SCRIPT_URL) the browser can't see directly. Mirrors
// stravaConfigured in services/strava.ts: a UI-only gate, not a security
// boundary (the endpoint itself is still owner-gated server-side).
export const sheetSyncConfigured = import.meta.env.VITE_SHEET_SYNC_ENABLED === 'true'

export interface SheetSyncResult {
  success: boolean
  exported: number
  failures: number
  // Always 0 (not absent) when Google Health isn't connected or has nothing
  // new to export — the notification only mentions weight/recovery when
  // these are > 0, so the two "nothing to report" cases don't need to be
  // told apart.
  weightExported?: number
  weightFailures?: number
  recoveryExported?: number
  recoveryFailures?: number
  error?: string
}

interface RawSheetSyncResult extends SheetSyncResult {
  // True when the server stopped early because it hit its own time budget,
  // not because the backlog is actually exhausted — see api/sheets/sync
  // .ts's SYNC_TIME_BUDGET_MS comment. Never surfaced past this file: a
  // caller just sees one combined result once the real backlog is drained.
  hasMore?: boolean
}

async function syncOnce(token: string): Promise<RawSheetSyncResult> {
  const res = await fetch('/api/sheets/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json()
  if (!res.ok) return { success: false, exported: 0, failures: 0, error: body.error || 'Sync failed' }
  return body
}

// The server bounds each call to a shared wall-clock budget (not a fixed
// row count) so it can never blow Vercel's 25s time-to-first-byte limit —
// see api/sheets/sync.ts. A backlog bigger than one budget's worth (e.g. a
// first-ever sync with 90 days of weight/recovery history to backfill)
// finishes across several calls instead of one, using the exact same
// per-row checkpoint that already makes a partial run safe to resume. This
// loop is what makes that invisible to the caller — one button press
// drains the whole backlog rather than needing several manual re-clicks.
// Capped at 20 rounds as a hard safety ceiling (a real backlog should
// finish in 2-3 at most); if something's still stuck after that, surfacing
// partial progress beats spinning forever.
const MAX_SYNC_ROUNDS = 20

export async function syncSessionsToSheet(): Promise<SheetSyncResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const totals: SheetSyncResult = { success: true, exported: 0, failures: 0, weightExported: 0, weightFailures: 0, recoveryExported: 0, recoveryFailures: 0 }

  for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
    const result = await syncOnce(token)
    if (!result.success) return result // surface the error immediately, don't keep looping

    totals.exported += result.exported
    totals.failures += result.failures
    totals.weightExported = (totals.weightExported ?? 0) + (result.weightExported ?? 0)
    totals.weightFailures = (totals.weightFailures ?? 0) + (result.weightFailures ?? 0)
    totals.recoveryExported = (totals.recoveryExported ?? 0) + (result.recoveryExported ?? 0)
    totals.recoveryFailures = (totals.recoveryFailures ?? 0) + (result.recoveryFailures ?? 0)

    if (!result.hasMore) break
  }

  return totals
}

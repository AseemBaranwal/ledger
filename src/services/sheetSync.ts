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
  // new to export — the notification only mentions weight when this is > 0,
  // so the two "nothing to report" cases don't need to be told apart.
  weightExported?: number
  weightFailures?: number
  error?: string
}

export async function syncSessionsToSheet(): Promise<SheetSyncResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch('/api/sheets/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json()
  if (!res.ok) return { success: false, exported: 0, failures: 0, error: body.error || 'Sync failed' }
  return body
}

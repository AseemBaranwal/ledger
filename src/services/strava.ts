import { supabase } from './supabaseClient'
import type { Session } from '@/types'

// Strava's OAuth redirects back to a dedicated path (not the app root) so it
// can never be confused with Supabase's own Google sign-in redirect — modern
// supabase-js uses PKCE by default, which *also* comes back as `?code=` on
// the root URL. Two different providers racing to interpret the same query
// param on the same page would be a real bug, not a hypothetical one.
export const STRAVA_CALLBACK_PATH = '/strava-callback'

export const stravaConfigured = Boolean(import.meta.env.VITE_STRAVA_CLIENT_ID)

export function getStravaAuthorizeUrl(): string | null {
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID
  if (!clientId) return null
  const redirectUri = `${window.location.origin}${STRAVA_CALLBACK_PATH}`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:write',
  })
  return `https://www.strava.com/oauth/authorize?${params.toString()}`
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function exchangeStravaCode(code: string): Promise<{ athleteName: string | null }> {
  const res = await authedFetch('/api/strava/exchange', { code })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not connect Strava')
  return { athleteName: data.athleteName ?? null }
}

export async function disconnectStrava(): Promise<void> {
  const res = await authedFetch('/api/strava/disconnect', {})
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not disconnect Strava')
  }
}

// Fire-and-forget from the caller's perspective — a Strava failure should
// never block or undo a local save, so this never throws; it just reports
// success/failure for an optional toast. exerciseNames maps an exercise code
// (e.g. "SQ") to its full name (e.g. "Squat") so the posted activity reads
// clearly to anyone who isn't fluent in this app's shorthand.
export async function postSessionToStrava(
  session: Session,
  programName: string,
  exerciseNames: Record<string, string> = {}
): Promise<{ ok: boolean; error?: string }> {
  try {
    const exercises = (session.ex || []).map((e) => ({ ...e, n: exerciseNames[e.k] }))
    const res = await authedFetch('/api/strava/post-activity', {
      code: session.s,
      name: programName,
      date: session.d,
      exercises,
      notes: session.n,
      startTime: session.st,
      endTime: session.et,
      tzOffsetMinutes: session.tz,
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error || 'Strava rejected the activity' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export interface StravaConnectionInfo {
  athleteName: string | null
  connectedAt: string
}

// Reads connection status directly via the normal (RLS-scoped) Supabase
// client — no need for a dedicated API endpoint just to check "am I
// connected", since the select policy already only ever returns the
// caller's own row.
export async function getStravaConnection(userId: string): Promise<StravaConnectionInfo | null> {
  const { data, error } = await supabase
    .from('strava_connections')
    .select('athlete_name, connected_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return { athleteName: data.athlete_name, connectedAt: data.connected_at }
}

import { supabase } from './supabaseClient'

// Same reasoning as STRAVA_CALLBACK_PATH in strava.ts: Google's OAuth
// redirects back to a dedicated path, never the app root, because Supabase's
// own Google sign-in uses PKCE and *also* comes back as `?code=` on the root
// URL. Two providers racing to interpret the same query param on the same
// page would be a real bug. This is a second, separate Google OAuth client
// from the sign-in one, so the two `?code=` values are not interchangeable.
export const GOOGLE_HEALTH_CALLBACK_PATH = '/google-health-callback'

export const googleHealthConfigured = Boolean(import.meta.env.VITE_GOOGLE_HEALTH_CLIENT_ID)

// Read-only recovery scopes. Heart-rate/HRV/resting-HR live under the
// health-metrics scope; sleep needs its own.
const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
]

export function getGoogleHealthAuthorizeUrl(): string | null {
  const clientId = import.meta.env.VITE_GOOGLE_HEALTH_CLIENT_ID
  if (!clientId) return null
  const redirectUri = `${window.location.origin}${GOOGLE_HEALTH_CALLBACK_PATH}`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_HEALTH_SCOPES.join(' '),
    // Both of these are required, not optional polish. Without
    // access_type=offline Google returns no refresh_token at all, and
    // without prompt=consent it withholds the refresh_token on every
    // authorization after the first — either way the backend rejects the
    // connection outright, since it can't keep the link alive past the
    // first access token's hour.
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
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

export async function exchangeGoogleHealthCode(code: string): Promise<void> {
  const redirectUri = `${window.location.origin}${GOOGLE_HEALTH_CALLBACK_PATH}`
  const res = await authedFetch('/api/google-health/exchange', { code, redirectUri })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not connect Google Health')
}

export async function disconnectGoogleHealth(): Promise<void> {
  const res = await authedFetch('/api/google-health/disconnect', {})
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not disconnect Google Health')
  }
}

export interface GoogleHealthConnectionInfo {
  connectedAt: string
  expiresAt: string | null
  scopes: string[] | null
  // Set server-side the moment a token refresh is rejected. While this app's
  // Google consent screen sits in "Testing" status, Google force-expires the
  // refresh token every 7 days — so this being set is the normal, scheduled
  // end of a connection's life, not a fault.
  refreshFailedAt: string | null
}

// Reads connection status directly via the normal (RLS-scoped) Supabase
// client — same as getStravaConnection. The token columns are deliberately
// not selected: the client never needs them, and the select policy only ever
// returns the caller's own row anyway.
export async function getGoogleHealthConnection(userId: string): Promise<GoogleHealthConnectionInfo | null> {
  const { data, error } = await supabase
    .from('google_health_connections')
    .select('connected_at, expires_at, scopes, refresh_failed_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return {
    connectedAt: data.connected_at,
    expiresAt: data.expires_at ?? null,
    scopes: data.scopes ?? null,
    refreshFailedAt: data.refresh_failed_at ?? null,
  }
}

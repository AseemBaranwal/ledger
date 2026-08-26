import { supabaseAdmin } from './supabaseAdmin.js'

// Google Health API — the replacement for the legacy Fitbit Web API, which
// is decommissioned September 2026 (see issue #59). Reads recovery metrics
// (resting HR, HRV, sleep) recorded by a Pixel Watch or Fitbit device.
//
// This module owns ALL token handling. Nothing else should read
// google_health_connections directly or touch a refresh token — callers go
// through getValidAccessToken() and get back either a usable token or an
// explicit "needs reconnect" state.

export const GOOGLE_HEALTH_BASE = 'https://health.googleapis.com/v4'

// Exact scope strings, verified against Google's own scopes documentation.
// Only these two — "only request the scopes needed" is both Google's own
// guidance and what keeps the consent screen honest about what this reads.
export const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
] as const

// Canonical data type identifiers, as they appear in
// `users/me/dataTypes/{id}`. Confirmed against the live v4 discovery doc —
// `daily-heart-rate-variability` (NOT the bare `heart-rate-variability`,
// which is a different, raw per-sample type with no daily aggregate) is the
// one whose DataPoint field is `dailyHeartRateVariability`.
export const DATA_TYPE = {
  restingHeartRate: 'daily-resting-heart-rate',
  hrv: 'daily-heart-rate-variability',
  sleep: 'sleep',
  // Unlike the three above, `weight` IS one of the data types dailyRollUp
  // supports — confirmed against the live discovery doc's
  // DailyRollupDataPoint response schema, which documents a `weight` field
  // (WeightRollupValue) alongside steps/distance/etc. See
  // api/_lib/bodyWeightData.ts for the actual fetch, which uses
  // rollUpDataPoints() below instead of listDataPoints's GET+filter pattern.
  weight: 'weight',
} as const

interface StoredConnection {
  access_token: string
  refresh_token: string
  expires_at: number
  refresh_failed_at: string | null
}

// Discriminated union so a caller physically cannot forget to handle the
// expired case — which is NOT an edge case here. While the OAuth consent
// screen is in "Testing" status, Google force-expires refresh tokens every
// 7 days, so "needs reconnect" is a routine, expected state.
export type TokenResult =
  | { status: 'ok'; accessToken: string }
  | { status: 'not_connected' }
  | { status: 'needs_reconnect'; reason: string }

function tokenEndpointCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_HEALTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

// Exchanges the one-time authorization code from the consent redirect for a
// token pair. redirectUri must byte-match the one used to build the
// authorize URL or Google rejects it (redirect_uri_mismatch).
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; scopes: string | null }> {
  const creds = tokenEndpointCredentials()
  if (!creds) throw new Error('Google Health is not configured on the server')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Google rejected the authorization code')
  }
  // Without a refresh_token the connection dies at the first access-token
  // expiry (~1h) with no way back — that happens when the consent screen
  // was skipped because the user already granted these scopes. The
  // authorize URL sets prompt=consent + access_type=offline specifically
  // to force one; if it's still missing, fail loudly rather than storing a
  // connection that's silently broken an hour later.
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and reconnect.'
    )
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // Google returns expires_in (seconds from now); store an absolute
    // instant so expiry checks never depend on when the row was read.
    expiresAt: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
    scopes: data.scope ?? null,
  }
}

export async function saveConnection(
  userId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: number; scopes: string | null }
): Promise<void> {
  // See exchange.ts's note on why supabase-js needs the `any` cast here —
  // no generated Database type in this project, so payloads infer as never.
  const { error } = await (supabaseAdmin().from('google_health_connections') as any).upsert(
    {
      user_id: userId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      scopes: tokens.scopes,
      // A fresh connect clears any prior expiry marker — this IS the
      // reconnect that resolves it.
      refresh_failed_at: null,
    },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(error.message)
}

async function readConnection(userId: string): Promise<StoredConnection | null> {
  const { data, error } = await supabaseAdmin()
    .from('google_health_connections')
    .select('access_token, refresh_token, expires_at, refresh_failed_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as StoredConnection
}

async function markRefreshFailed(userId: string): Promise<void> {
  try {
    await (supabaseAdmin().from('google_health_connections') as any)
      .update({ refresh_failed_at: new Date().toISOString() })
      .eq('user_id', userId)
  } catch {
    // Best-effort — the caller already knows it failed and is returning
    // needs_reconnect regardless; failing to record it must not escalate.
  }
}

// The only way anything in this app gets a usable Google Health token.
// Refreshes transparently when the current one is expired or nearly so.
export async function getValidAccessToken(userId: string): Promise<TokenResult> {
  const conn = await readConnection(userId)
  if (!conn) return { status: 'not_connected' }

  // 60s skew guard so a token that expires mid-request doesn't 401 a call
  // that looked valid at the moment it was checked.
  const nowSec = Math.floor(Date.now() / 1000)
  if (conn.expires_at > nowSec + 60) {
    return { status: 'ok', accessToken: conn.access_token }
  }

  const creds = tokenEndpointCredentials()
  if (!creds) return { status: 'needs_reconnect', reason: 'Google Health is not configured on the server' }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // The expected path once every 7 days while the OAuth app is in
    // Testing status: Google returns invalid_grant for a force-expired
    // refresh token. Record it so the UI can prompt a reconnect rather
    // than the app silently showing no recovery data forever.
    await markRefreshFailed(userId)
    return {
      status: 'needs_reconnect',
      reason: data.error === 'invalid_grant'
        ? 'Google Health access expired — reconnect to keep recovery data flowing.'
        : data.error_description || data.error || 'Could not refresh Google Health access.',
    }
  }

  const accessToken = data.access_token as string
  const expiresAt = nowSec + (Number(data.expires_in) || 3600)

  // Google usually omits refresh_token on a refresh response — keep the
  // existing one when it does, rather than writing undefined over it.
  await (supabaseAdmin().from('google_health_connections') as any)
    .update({
      access_token: accessToken,
      expires_at: expiresAt,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      refresh_failed_at: null,
    })
    .eq('user_id', userId)

  return { status: 'ok', accessToken }
}

// ── civil dates ──────────────────────────────────────────────────
// The API takes civil dates ({year, month, day}), NOT unix timestamps —
// a genuine difference from Strava's API and an easy source of silent
// off-by-a-day bugs if a Date's UTC vs local parts get mixed.
//
// CONFIRMED against the live v4 discovery doc (health.googleapis.com/$discovery/rest?version=v4):
// a bare {year,month,day} is NOT what `range.start`/`range.end` take — that
// 400s with "Unknown name \"year\": Cannot find field." The wire type is
// `CivilTimeInterval { start: CivilDateTime, end: CivilDateTime }` where
// `CivilDateTime { date: Date, time?: TimeOfDay }` — the plain {year,month,day}
// object has to be wrapped one level deeper under `date`. Response points
// carry the same CivilDateTime shape on `civilStartTime`/`civilEndTime`, so
// reading those back needs the same unwrap.

export interface CivilDate {
  year: number
  month: number
  day: number
}

export interface CivilDateTime {
  date: CivilDate
}

// Confirmed against the live discovery doc's CivilTimeInterval schema:
// { start: CivilDateTime, end: CivilDateTime } — a closed-open range, same
// wrapping requirement as CivilDateTime itself (no bare {year,month,day}).
export interface CivilTimeInterval {
  start: CivilDateTime
  end: CivilDateTime
}

export function toCivilDate(d: Date): CivilDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

export function toCivilDateTime(d: Date): CivilDateTime {
  return { date: toCivilDate(d) }
}

export function civilDateToIso(c: CivilDate | undefined | null): string | null {
  if (!c || !c.year || !c.month || !c.day) return null
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`
}

export function civilDateTimeToIso(c: CivilDateTime | undefined | null): string | null {
  return civilDateToIso(c?.date)
}

// Low-level authed call against the Google Health API. Returns parsed JSON,
// or throws with the upstream detail attached so callers can log something
// actionable rather than a bare "request failed".
export async function googleHealthRequest(
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<any> {
  const res = await fetch(`${GOOGLE_HEALTH_BASE}/${path.replace(/^\//, '')}`, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  })

  const text = await res.text()
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // fall through — a non-JSON body is itself the useful detail below
  }

  if (!res.ok) {
    const detail = parsed?.error?.message || text?.slice(0, 300) || `HTTP ${res.status}`
    const err = new Error(`Google Health API ${res.status}: ${detail}`)
    ;(err as any).status = res.status
    throw err
  }
  return parsed
}

// `POST .../dataPoints:dailyRollUp` — distinct from googleHealthRequest's
// bare GET+filter usage above (that's the `list` pattern recoveryData.ts
// uses for sleep/RHR/HRV, all three of which explicitly reject dailyRollUp
// with a 400). Weight is one of the data types the response union DOES
// support (see DATA_TYPE.weight's comment), so this is the simpler shape:
// one POST returns an already-aggregated per-civil-day average instead of
// raw samples the caller would otherwise have to bucket by date itself.
export async function rollUpDataPoints(
  accessToken: string,
  dataType: string,
  range: CivilTimeInterval
): Promise<any> {
  return googleHealthRequest(accessToken, `users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
    method: 'POST',
    body: { range },
  })
}

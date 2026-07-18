import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { sportTypeForCode, estimateElapsedSeconds, buildActivityDescription } from '../_lib/stravaMapping.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

interface StravaConnection {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: number
}

async function refreshIfNeeded(conn: StravaConnection, clientId: string, clientSecret: string): Promise<StravaConnection> {
  const now = Math.floor(Date.now() / 1000)
  if (conn.expires_at > now + 60) return conn // still valid with a minute of buffer

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Could not refresh Strava token')
  const data = await res.json()

  // See exchange.ts for why this cast is needed — no generated Database type,
  // so supabase-js can't infer strava_connections' row shape.
  await (supabaseAdmin().from('strava_connections') as any)
    .update({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at })
    .eq('user_id', conn.user_id)

  return { ...conn, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at }
}

// Called right after a PROGRAM session saves successfully, alongside (not
// instead of) the existing Google Sheet push. Best-effort from the client's
// perspective — a failure here shouldn't block or undo the local save.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let payload: { code?: string; name?: string; date?: string; exercises?: Array<{ k: string; r: number[]; ws?: number[]; w?: number | null }>; notes?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { code, name, date, exercises, notes } = payload
  if (!code || !date || !Array.isArray(exercises) || exercises.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing code, date, or exercises' }), { status: 400 })
  }

  const { data: connection, error: connErr } = await supabaseAdmin()
    .from('strava_connections')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (connErr || !connection) {
    return new Response(JSON.stringify({ error: 'Strava is not connected' }), { status: 404 })
  }

  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'Strava is not configured on the server' }), { status: 500 })
  }

  let conn: StravaConnection
  try {
    conn = await refreshIfNeeded(connection as StravaConnection, clientId, clientSecret)
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not refresh Strava token' }), { status: 502 })
  }

  const activityRes = await fetch('https://www.strava.com/api/v3/activities', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: name || `Ledger: ${code}`,
      sport_type: sportTypeForCode(code),
      start_date_local: `${date}T12:00:00Z`, // Ledger doesn't track real start time — noon is a placeholder
      elapsed_time: estimateElapsedSeconds(exercises),
      description: buildActivityDescription(exercises, notes),
    }),
  })

  if (!activityRes.ok) {
    const detail = await activityRes.text()
    return new Response(JSON.stringify({ error: 'Strava rejected the activity', detail }), { status: 502 })
  }

  const activity = await activityRes.json()
  return new Response(JSON.stringify({ success: true, activityId: activity.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

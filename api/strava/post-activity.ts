import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import {
  sportTypeForCode,
  supportsStructuredSets,
  buildActivityDescription,
  buildStravaSets,
  resolveTiming,
} from '../_lib/stravaMapping.js'

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Strava's JSON upload is async: the POST just enqueues it, and the actual
// activity id only shows up once background processing finishes. Strava's
// own docs say mean processing time is under 2s, so polling for up to 8s
// comfortably covers the normal case without holding the function open
// indefinitely on a stuck upload.
async function pollUploadUntilDone(uploadId: number, accessToken: string): Promise<{ activityId?: number; error?: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(1000)
    const res = await fetch(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) continue
    const data = await res.json()
    if (data.activity_id) return { activityId: data.activity_id }
    if (data.error) return { error: data.error }
  }
  return { error: undefined } // timed out, but not necessarily failed — Strava may still finish it
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

  let payload: {
    code?: string
    name?: string
    date?: string
    exercises?: Array<{ k: string; n?: string; r: number[]; ws?: number[]; w?: number | null }>
    notes?: string
    startTime?: string
    endTime?: string
  }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { code, name, date, exercises, notes, startTime, endTime } = payload
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

  const sportType = sportTypeForCode(code)
  const activityName = name || `Ledger: ${code}`
  const description = buildActivityDescription(exercises, notes)
  const { startTimeIso, elapsedSeconds } = resolveTiming(date, exercises, startTime, endTime)

  // Weight-training sessions go through Strava's structured JSON upload so
  // sets/reps/weight render as native Exercise cards (the feature this whole
  // path exists for). Everything else (e.g. sprint sessions, sport_type
  // "Run") falls back to a plain activity with just a text description,
  // since Strava only accepts the sets format for a handful of sport types.
  if (supportsStructuredSets(sportType)) {
    const file = {
      version: '1.0',
      start_time: startTimeIso,
      utc_offset: 0,
      elapsed_time: elapsedSeconds,
      sets: buildStravaSets(exercises),
    }

    const form = new FormData()
    form.set('data_type', 'json')
    form.set('sport_type', sportType)
    form.set('name', activityName)
    form.set('description', description)
    form.set('file', new Blob([JSON.stringify(file)], { type: 'application/json' }), 'workout.json')

    const uploadRes = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}` },
      body: form,
    })

    if (!uploadRes.ok) {
      const detail = await uploadRes.text()
      return new Response(JSON.stringify({ error: 'Strava rejected the upload', detail }), { status: 502 })
    }

    const upload = await uploadRes.json()
    if (upload.error) {
      return new Response(JSON.stringify({ error: 'Strava rejected the upload', detail: upload.error }), { status: 502 })
    }
    if (upload.activity_id) {
      return new Response(JSON.stringify({ success: true, activityId: upload.activity_id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { activityId, error } = await pollUploadUntilDone(upload.id, conn.access_token)
    if (error) {
      return new Response(JSON.stringify({ error: 'Strava rejected the upload', detail: error }), { status: 502 })
    }
    if (!activityId) {
      // Still processing after 8s — genuinely rare given Strava's own <2s
      // average, but the upload was accepted, so report success rather than
      // erroring; it'll finish appearing on Strava shortly on its own.
      return new Response(JSON.stringify({ success: true, activityId: null, pending: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ success: true, activityId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const activityRes = await fetch('https://www.strava.com/api/v3/activities', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: activityName,
      sport_type: sportType,
      start_date_local: startTimeIso,
      elapsed_time: elapsedSeconds,
      description,
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

import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// Called once, right after the user approves Strava's OAuth consent screen
// and gets redirected back to the app with a `code` in the URL. This is the
// only place STRAVA_CLIENT_SECRET is used — it can never be sent to the
// browser, so the code-for-tokens exchange has to happen here, not client-side.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let code: string | undefined
  try {
    const body = await req.json()
    code = body.code
  } catch {
    // fall through to the missing-code check below
  }
  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400 })
  }

  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'Strava is not configured on the server' }), { status: 500 })
  }

  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const detail = await tokenRes.text()
    return new Response(JSON.stringify({ error: 'Strava rejected the authorization code', detail }), { status: 400 })
  }

  const tokenData = await tokenRes.json()
  const athleteName = [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(' ') || null

  // supabase-js can't infer table row shapes without a generated Database
  // type (none exists in this project), which makes .upsert()'s argument
  // type resolve to `never` rather than `any` — hence the cast.
  const { error } = await (supabaseAdmin().from('strava_connections') as any).upsert(
    {
      user_id: user.id,
      athlete_id: tokenData.athlete?.id ?? null,
      athlete_name: athleteName,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
    },
    { onConflict: 'user_id' }
  )

  if (error) {
    return new Response(JSON.stringify({ error: 'Could not save the Strava connection', detail: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true, athleteName }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

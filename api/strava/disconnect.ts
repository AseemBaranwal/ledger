import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// Deleting the row needs the service_role key — there's deliberately no
// user-facing delete policy on strava_connections in Supabase, so this is
// the only path to disconnect.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Best-effort: also revoke the token on Strava's side so it stops showing
  // up as an authorized app in the athlete's Strava settings. Not fatal if
  // this fails — the local row still gets deleted either way.
  try {
    const { data: connection } = await supabaseAdmin()
      .from('strava_connections')
      .select('access_token')
      .eq('user_id', user.id)
      .single<{ access_token: string }>()
    if (connection?.access_token) {
      await fetch(`https://www.strava.com/oauth/deauthorize?access_token=${connection.access_token}`, {
        method: 'POST',
      })
    }
  } catch {
    // ignore — proceed to delete the row regardless
  }

  const { error } = await supabaseAdmin().from('strava_connections').delete().eq('user_id', user.id)
  if (error) {
    return new Response(JSON.stringify({ error: 'Could not disconnect', detail: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

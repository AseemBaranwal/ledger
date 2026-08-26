import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// See ../strava/exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

// Deleting the row needs the service_role key — there's deliberately no
// user-facing delete policy on google_health_connections, so this is the
// only path to disconnect. Mirrors ../strava/disconnect.ts.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Best-effort revoke on Google's side so the app stops appearing under
  // the user's third-party access list. Not fatal — the local row gets
  // deleted either way, which is what actually disconnects it here.
  try {
    const { data: connection } = await supabaseAdmin()
      .from('google_health_connections')
      .select('access_token')
      .eq('user_id', user.id)
      .single<{ access_token: string }>()
    if (connection?.access_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(connection.access_token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    }
  } catch {
    // ignore — proceed to delete the row regardless
  }

  const { error } = await supabaseAdmin().from('google_health_connections').delete().eq('user_id', user.id)
  if (error) {
    return new Response(JSON.stringify({ error: 'Could not disconnect', detail: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

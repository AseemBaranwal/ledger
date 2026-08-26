import { requireUser } from '../_lib/auth.js'
import { exchangeCodeForTokens, saveConnection } from '../_lib/googleHealth.js'

// See ../strava/exchange.ts for why every handler pins the Edge Runtime.
export const config = { runtime: 'edge' }

// Called once, right after the user approves Google's consent screen and
// lands back on the app with a `code`. This is the only place
// GOOGLE_HEALTH_CLIENT_SECRET is used — the code-for-tokens exchange can
// never happen client-side.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let code: string | undefined
  let redirectUri: string | undefined
  try {
    const body = await req.json()
    code = body.code
    redirectUri = body.redirectUri
  } catch {
    // fall through to the validation below
  }
  if (!code || !redirectUri) {
    return new Response(JSON.stringify({ error: 'Missing code or redirectUri' }), { status: 400 })
  }

  try {
    // redirectUri comes from the client because it's origin-dependent
    // (localhost vs a preview URL vs prod) and Google requires it to match
    // the authorize call byte-for-byte. It's not a trust boundary: Google
    // itself rejects any value not on the project's allow-list.
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    await saveConnection(user.id, tokens)
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not connect Google Health'
    return new Response(JSON.stringify({ error: message }), { status: 400 })
  }
}

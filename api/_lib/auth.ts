// Verifies the caller's Supabase session token (sent by the client exactly
// like it authenticates with Supabase directly) and returns their user id.
// This is how these endpoints know WHO is asking without trusting anything
// the client claims about itself — the token is checked against Supabase,
// not just decoded.
//
// Calls Supabase Auth's REST API directly rather than going through
// supabase-js's auth.getUser(jwt) — that path kept throwing a spurious
// "Auth session missing!" under Vercel's Edge Runtime even with a verified
// non-expired token attached, and wasn't worth chasing further given a
// one-endpoint REST call does exactly what's needed here.
export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('requireUser: token rejected', res.status, await res.text())
    return null
  }

  const user = await res.json()
  if (!user?.id) return null
  return { id: user.id }
}

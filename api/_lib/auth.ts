import { supabaseAdmin } from './supabaseAdmin.js'

// Verifies the caller's Supabase session token (sent by the client exactly
// like it authenticates with Supabase directly) and returns their user id.
// This is how these endpoints know WHO is asking without trusting anything
// the client claims about itself — the token is checked against Supabase,
// not just decoded.
export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data, error } = await supabaseAdmin().auth.getUser(token)
  if (error || !data.user) {
    console.error('requireUser: token rejected', error?.message || 'no user in response')
    return null
  }
  return { id: data.user.id }
}

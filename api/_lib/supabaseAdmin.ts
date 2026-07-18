import { createClient } from '@supabase/supabase-js'

// Server-only client using the service_role key, which bypasses row-level
// security entirely. Never import this from client code, and never let this
// key reach the browser — it's set as a Vercel environment variable without
// the VITE_ prefix specifically so Vite won't bundle it into the frontend.
let client: ReturnType<typeof createClient> | null = null

export function supabaseAdmin() {
  if (client) return client
  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on the server')
  }
  client = createClient(url, serviceKey, { auth: { persistSession: false } })
  return client
}

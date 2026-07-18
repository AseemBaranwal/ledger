import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — sign-in will not work until they are configured.')
}

// createClient throws synchronously on an invalid/empty URL, which would
// crash the whole module graph before React ever mounts. Fall back to a
// syntactically valid placeholder so the app can still boot (and show the
// sign-in screen, which will just fail to actually authenticate) when these
// aren't configured yet — e.g. local dev before Supabase is set up.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key')

export interface Profile {
  id: string
  email: string | null
  display_name: string | null
  sheet_url: string | null
  routine_config: unknown | null
}

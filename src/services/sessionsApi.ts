import { supabase } from './supabaseClient'
import { getCurrentUserId } from './userScope'
import type { Session } from '@/types'

// Replaces appScript.ts — sessions now live in Supabase's `sessions` table
// (see supabase/sessions.sql), written directly by the client via RLS
// (auth.uid() = user_id) instead of proxied through a Google Apps Script
// Web App. No server API layer needed: this is benign per-user fitness
// data, not security-sensitive like the Coach-chat tables.

interface SessionRow {
  id: string
  d: string
  s: string | null
  g: string | null
  ex: unknown
  n: string | null
  type: string | null
  t: string | null
  items: unknown
  st: string | null
  et: string | null
  tz: number | null
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    d: row.d,
    s: row.s ?? undefined,
    g: row.g ?? undefined,
    ex: (row.ex as Session['ex']) ?? undefined,
    n: row.n ?? undefined,
    type: (row.type as Session['type']) ?? undefined,
    t: row.t ?? undefined,
    items: (row.items as Session['items']) ?? undefined,
    st: row.st ?? undefined,
    et: row.et ?? undefined,
    tz: row.tz ?? undefined,
  }
}

// supabase-js does NOT throw on a query error the way the old no-cors fetch
// calls effectively did — `.insert(...)` resolves normally with `{error}`
// set for an RLS denial or constraint violation. Explicitly checking and
// throwing here is what makes sessionStore.ts's existing pendingSync retry
// queue behave the same way it always did, instead of silently treating a
// real failure as a successful sync.
export async function insertSession(session: Session): Promise<void> {
  const userId = getCurrentUserId()
  if (!userId) throw new Error('Not signed in')

  const { error } = await supabase.from('sessions').insert({
    id: session.id,
    user_id: userId,
    d: session.d,
    s: session.s ?? null,
    g: session.g ?? null,
    ex: session.ex ?? null,
    n: session.n ?? null,
    type: session.type ?? null,
    t: session.t ?? null,
    items: session.items ?? null,
    st: session.st ?? null,
    et: session.et ?? null,
    tz: session.tz ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function fetchSessions(userId: string): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, d, s, g, ex, n, type, t, items, st, et, tz')
    .eq('user_id', userId)
    .order('d', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data as SessionRow[]) || []).map(rowToSession)
}

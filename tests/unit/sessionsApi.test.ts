import { describe, it, expect, vi, beforeEach } from 'vitest'
import { insertSession, fetchSessions } from '@/services/sessionsApi'
import { supabase } from '@/services/supabaseClient'
import { setCurrentUserId } from '@/services/userScope'
import type { Session } from '@/types'

vi.mock('@/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}))

describe('insertSession', () => {
  beforeEach(() => {
    setCurrentUserId('user-1')
    vi.clearAllMocks()
  })

  it('throws when nobody is signed in, before attempting any query', async () => {
    setCurrentUserId(null)

    await expect(insertSession({ id: 'x', d: '2026-01-01' } as Session)).rejects.toThrow('Not signed in')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  // The critical case: supabase-js resolves NORMALLY with {error} set for an
  // RLS denial or constraint violation — it does not throw the way the old
  // no-cors fetch calls effectively did (a resolved fetch was the only
  // success signal available then). A naive port that didn't check {error}
  // explicitly would silently treat this exact case as a successful sync.
  it('throws with the Supabase error message on a query failure, instead of resolving silently', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      insert: () => Promise.resolve({ error: { message: 'new row violates row-level security policy' } }),
    } as any)

    await expect(insertSession({ id: 'x', d: '2026-01-01' } as Session)).rejects.toThrow(
      'new row violates row-level security policy'
    )
  })

  it('resolves cleanly when the insert succeeds', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      insert: () => Promise.resolve({ error: null }),
    } as any)

    await expect(insertSession({ id: 'x', d: '2026-01-01' } as Session)).resolves.toBeUndefined()
  })
})

describe('fetchSessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps rows back into Session objects, dropping nulls in favor of undefined', async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () =>
        Promise.resolve({
          data: [
            {
              id: 'x', d: '2026-01-01', s: 'LA', g: 'Gym', ex: [{ k: 'SQ', r: [5], ws: [80] }],
              n: null, type: 'PROGRAM', t: null, items: null, st: null, et: null, tz: null,
            },
          ],
          error: null,
        }),
    }
    vi.mocked(supabase.from).mockReturnValue(chain)

    const result = await fetchSessions('user-1')

    expect(result).toEqual([
      { id: 'x', d: '2026-01-01', s: 'LA', g: 'Gym', ex: [{ k: 'SQ', r: [5], ws: [80] }], n: undefined, type: 'PROGRAM', t: undefined, items: undefined, st: undefined, et: undefined, tz: undefined },
    ])
  })

  it('throws on a query error instead of returning an empty result silently', async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: null, error: { message: 'network error' } }),
    }
    vi.mocked(supabase.from).mockReturnValue(chain)

    await expect(fetchSessions('user-1')).rejects.toThrow('network error')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncSessionsToSheet } from '@/services/sheetSync'
import { supabase } from '@/services/supabaseClient'

vi.mock('@/services/supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}))

function jsonResponse(ok: boolean, body: unknown) {
  return { ok, json: () => Promise.resolve(body) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  } as any)
})

describe('syncSessionsToSheet — auto-continuation', () => {
  // The server bounds each call to a shared wall-clock budget (not a fixed
  // row count) and reports hasMore when it stopped early because of that,
  // not because the backlog is actually empty — see api/sheets/sync.ts.
  // A large first-ever backlog (e.g. 90 days of weight/recovery history)
  // can genuinely need several rounds to fully drain.
  it('keeps calling the endpoint while hasMore is true, and sums totals across rounds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(true, { success: true, exported: 5, failures: 0, weightExported: 20, weightFailures: 0, recoveryExported: 0, recoveryFailures: 0, hasMore: true }))
        .mockResolvedValueOnce(jsonResponse(true, { success: true, exported: 0, failures: 0, weightExported: 15, weightFailures: 0, recoveryExported: 10, recoveryFailures: 0, hasMore: true }))
        .mockResolvedValueOnce(jsonResponse(true, { success: true, exported: 0, failures: 0, weightExported: 0, weightFailures: 0, recoveryExported: 5, recoveryFailures: 1, hasMore: false }))
    )

    const result = await syncSessionsToSheet()

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      success: true,
      exported: 5,
      weightExported: 35,
      recoveryExported: 15,
      recoveryFailures: 1,
    })
  })

  it('stops after one call when hasMore is false or absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(true, { success: true, exported: 2, failures: 0 })))

    const result = await syncSessionsToSheet()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.exported).toBe(2)
  })

  it('stops immediately and surfaces the error, without looping, on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(false, { error: 'Sheet sync is not configured on the server' }))
    )

    const result = await syncSessionsToSheet()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: false, exported: 0, failures: 0, error: 'Sheet sync is not configured on the server' })
  })

  // A real safety ceiling, not just a theoretical one — if something were
  // ever stuck reporting hasMore:true forever (a server bug, a checkpoint
  // that never advances), this is what stops the client from hammering the
  // endpoint in an infinite loop.
  it('stops at the round ceiling even if the server keeps reporting hasMore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(true, { success: true, exported: 1, failures: 0, hasMore: true }))
    )

    const result = await syncSessionsToSheet()

    expect(fetch).toHaveBeenCalledTimes(20)
    expect(result.exported).toBe(20)
  })
})

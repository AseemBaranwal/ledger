import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBodyWeightData } from '../../api/_lib/bodyWeightData'
import { getValidAccessToken, rollUpDataPoints } from '../../api/_lib/googleHealth'
import { supabaseAdmin } from '../../api/_lib/supabaseAdmin'

// Mocked at the same seam recoveryData.test.ts uses — the module's own
// token handling + authed request — so these tests exercise the real
// grams->lb conversion and civil-date parsing rather than a re-implementation
// of it. rollUpDataPoints (not the lower-level googleHealthRequest) is the
// right seam here since bodyWeightData.ts calls that directly.
vi.mock('../../api/_lib/googleHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/_lib/googleHealth')>()
  return { ...actual, getValidAccessToken: vi.fn(), rollUpDataPoints: vi.fn() }
})
vi.mock('../../api/_lib/supabaseAdmin', () => ({ supabaseAdmin: vi.fn() }))

const okToken = { status: 'ok' as const, accessToken: 'tok' }

const civilDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

// Shape confirmed against the discovery doc's DailyRollupDataPoint schema —
// see bodyWeightData.ts's file comment for why this data type uses
// dailyRollUp rather than the list+filter pattern recoveryData.ts uses.
function rollupPoint(date: string, weightGramsAvg: number | undefined) {
  return {
    civilStartTime: { date: civilDate(date) },
    civilEndTime: { date: civilDate(date) },
    ...(weightGramsAvg !== undefined ? { weight: { weightGramsAvg } } : {}),
  }
}

function mockUpsert() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(supabaseAdmin).mockReturnValue({ from: () => ({ upsert }) } as any)
  return upsert
}

beforeEach(() => {
  vi.mocked(getValidAccessToken).mockReset()
  vi.mocked(rollUpDataPoints).mockReset()
  vi.mocked(getValidAccessToken).mockResolvedValue(okToken)
})

describe('getBodyWeightData — connection states', () => {
  it('returns not_connected without calling rollUpDataPoints', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue({ status: 'not_connected' })
    mockUpsert()

    expect(await getBodyWeightData('user-1')).toEqual({ status: 'not_connected' })
    expect(rollUpDataPoints).not.toHaveBeenCalled()
  })

  // Expected weekly while the OAuth app is in Testing status, not
  // exceptional — same as recoveryData.ts's needs_reconnect handling.
  it('passes through needs_reconnect with its reason, and makes no API call', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue({ status: 'needs_reconnect', reason: 'expired' })
    mockUpsert()

    expect(await getBodyWeightData('user-1')).toEqual({ status: 'needs_reconnect', reason: 'expired' })
    expect(rollUpDataPoints).not.toHaveBeenCalled()
  })
})

describe('getBodyWeightData — happy path', () => {
  it('converts grams to lb (rounded to 0.1) and returns ascending days with the last as latest', async () => {
    vi.mocked(rollUpDataPoints).mockResolvedValue({
      rollupDataPoints: [rollupPoint('2026-08-21', 81200), rollupPoint('2026-08-20', 80800)],
    })
    mockUpsert()

    const result = await getBodyWeightData('user-1')

    expect(result).toEqual({
      status: 'ok',
      days: [
        { date: '2026-08-20', weightLb: 178.1 }, // 80800g / 453.59237
        { date: '2026-08-21', weightLb: 179.0 }, // 81200g / 453.59237
      ],
      latest: { date: '2026-08-21', weightLb: 179.0 },
    })
  })

  it('skips a day with no weight field rather than plotting it as 0 lb', async () => {
    vi.mocked(rollUpDataPoints).mockResolvedValue({
      rollupDataPoints: [rollupPoint('2026-08-20', 80000), rollupPoint('2026-08-21', undefined)],
    })
    mockUpsert()

    const result = await getBodyWeightData('user-1')

    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.days).toHaveLength(1)
      expect(result.days[0].date).toBe('2026-08-20')
    }
  })

  it('returns latest: null and an empty days array when the window has no readings at all', async () => {
    vi.mocked(rollUpDataPoints).mockResolvedValue({ rollupDataPoints: [] })
    mockUpsert()

    expect(await getBodyWeightData('user-1')).toEqual({ status: 'ok', days: [], latest: null })
  })

  it('passes the requested days through as the fetch window, defaulting to 6', async () => {
    vi.mocked(rollUpDataPoints).mockResolvedValue({ rollupDataPoints: [] })
    mockUpsert()

    const spanDays = (range: { start: { date: { year: number; month: number; day: number } }; end: { date: { year: number; month: number; day: number } } }) => {
      const toDate = (c: { year: number; month: number; day: number }) => new Date(c.year, c.month - 1, c.day)
      return Math.round((toDate(range.end.date).getTime() - toDate(range.start.date).getTime()) / 86400000)
    }

    await getBodyWeightData('user-1')
    expect(spanDays(vi.mocked(rollUpDataPoints).mock.calls[0][2])).toBe(6)

    await getBodyWeightData('user-1', { days: 30 })
    expect(spanDays(vi.mocked(rollUpDataPoints).mock.calls[1][2])).toBe(30)
  })

  it('upserts the fetched days into google_health_weight, best-effort', async () => {
    vi.mocked(rollUpDataPoints).mockResolvedValue({ rollupDataPoints: [rollupPoint('2026-08-20', 80800)] })
    const upsert = mockUpsert()

    await getBodyWeightData('user-1')

    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ user_id: 'user-1', d: '2026-08-20', weight_lb: 178.1 })],
      { onConflict: 'user_id,d' }
    )
  })

  it('does not let a persistence failure break the returned result', async () => {
    vi.mocked(rollUpDataPoints).mockResolvedValue({ rollupDataPoints: [rollupPoint('2026-08-20', 80800)] })
    vi.mocked(supabaseAdmin).mockReturnValue({
      from: () => ({ upsert: vi.fn().mockRejectedValue(new Error('db down')) }),
    } as any)

    const result = await getBodyWeightData('user-1')
    expect(result.status).toBe('ok')
  })
})

describe('getBodyWeightData — error handling', () => {
  it('returns status: error when the API call throws', async () => {
    vi.mocked(rollUpDataPoints).mockRejectedValue(new Error('Google Health API 500: upstream failure'))
    mockUpsert()

    expect(await getBodyWeightData('user-1')).toEqual({
      status: 'error',
      error: 'Google Health API 500: upstream failure',
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRecoveryData, sleepMinutesOf } from '../../api/_lib/recoveryData'
import { getValidAccessToken, googleHealthRequest } from '../../api/_lib/googleHealth'

// Mocked at the googleHealth boundary — the same seam the real module owns
// (token handling + the authed request), so these tests exercise the actual
// parsing/rollup/median logic rather than a re-implementation of it. The
// rest of googleHealth (extractNumber, civilDateToIso, DATA_TYPE) stays real
// on purpose: the defensive extraction IS what's under test here.
vi.mock('../../api/_lib/googleHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/_lib/googleHealth')>()
  return { ...actual, getValidAccessToken: vi.fn(), googleHealthRequest: vi.fn() }
})

const okToken = { status: 'ok' as const, accessToken: 'tok' }

// Routes each dailyRollUp call to the right fixture by the data type in its
// path, so a test can supply just the types it cares about.
function mockRollups(byType: {
  restingHeartRate?: unknown[] | Error
  hrv?: unknown[] | Error
  sleep?: unknown[] | Error
}) {
  vi.mocked(googleHealthRequest).mockImplementation(async (_token: string, path: string) => {
    const key = path.includes('daily-resting-heart-rate')
      ? 'restingHeartRate'
      : path.includes('heart-rate-variability')
        ? 'hrv'
        : 'sleep'
    const fixture = byType[key as keyof typeof byType]
    if (fixture instanceof Error) throw fixture
    return { rollupDataPoints: fixture ?? [] }
  })
}

const civil = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

beforeEach(() => {
  vi.mocked(getValidAccessToken).mockReset()
  vi.mocked(googleHealthRequest).mockReset()
  vi.mocked(getValidAccessToken).mockResolvedValue(okToken)
})

describe('getRecoveryData — connection states', () => {
  it('returns not_connected without making any API call', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue({ status: 'not_connected' })

    expect(await getRecoveryData('user-1')).toEqual({ status: 'not_connected' })
    expect(googleHealthRequest).not.toHaveBeenCalled()
  })

  // Expected weekly, not exceptional: Google force-expires refresh tokens
  // every 7 days while the OAuth app is in Testing status (issue #59).
  it('passes through needs_reconnect with its reason, and makes no API call', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue({ status: 'needs_reconnect', reason: 'Google Health access expired' })

    expect(await getRecoveryData('user-1')).toEqual({
      status: 'needs_reconnect',
      reason: 'Google Health access expired',
    })
    expect(googleHealthRequest).not.toHaveBeenCalled()
  })
})

describe('getRecoveryData — happy path', () => {
  it('flattens all three data types into one row per date, ascending', async () => {
    mockRollups({
      restingHeartRate: [
        { civilStartTime: civil('2026-08-20'), bpm: 54.4 },
        { civilStartTime: civil('2026-08-21'), bpm: 58.6 },
      ],
      hrv: [
        { civilStartTime: civil('2026-08-20'), rmssd: 62.34 },
        { civilStartTime: civil('2026-08-21'), rmssd: 41.06 },
      ],
      sleep: [
        { civilStartTime: civil('2026-08-19'), civilEndTime: civil('2026-08-20'), durationMinutes: 431.4, sleepScore: 82 },
        { civilStartTime: civil('2026-08-20'), civilEndTime: civil('2026-08-21'), durationMinutes: 352.5, sleepScore: 65 },
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toEqual({
      status: 'ok',
      days: [
        { date: '2026-08-20', restingHeartRate: 54, hrvMs: 62.3, sleepMinutes: 431, sleepScore: 82 },
        { date: '2026-08-21', restingHeartRate: 59, hrvMs: 41.1, sleepMinutes: 353, sleepScore: 65 },
      ],
      baselines: { restingHeartRate: 57, hrvMs: 51.7, sleepMinutes: 392 },
    })
  })

  it('requests a dailyRollUp per data type, in parallel, with the documented body shape', async () => {
    mockRollups({})

    await getRecoveryData('user-1')

    expect(googleHealthRequest).toHaveBeenCalledTimes(3)
    const paths = vi.mocked(googleHealthRequest).mock.calls.map((c) => c[1])
    expect(paths).toEqual([
      'users/me/dataTypes/daily-resting-heart-rate/dataPoints:dailyRollUp',
      'users/me/dataTypes/heart-rate-variability/dataPoints:dailyRollUp',
      'users/me/dataTypes/sleep/dataPoints:dailyRollUp',
    ])
    const init = vi.mocked(googleHealthRequest).mock.calls[0][2] as { method: string; body: any }
    expect(init.method).toBe('POST')
    expect(init.body).toMatchObject({ windowSizeDays: 1, pageSize: 1440 })
    expect(init.body.range.start).toEqual(expect.objectContaining({ year: expect.any(Number), month: expect.any(Number), day: expect.any(Number) }))
  })

  // Google 400s an over-long range rather than clamping it itself, and the
  // caps differ by data type: 14 days for heart-rate, 90 for everything else.
  it('clamps the heart-rate range to 14 days even when a longer window is asked for', async () => {
    mockRollups({})

    await getRecoveryData('user-1', { days: 60 })

    const [hrCall, , sleepCall] = vi.mocked(googleHealthRequest).mock.calls
    const spanDays = (body: any) => {
      const asDate = (c: any) => new Date(c.year, c.month - 1, c.day).getTime()
      return Math.round((asDate(body.range.end) - asDate(body.range.start)) / 86400000) + 1
    }
    expect(spanDays((hrCall[2] as any).body)).toBe(14)
    expect(spanDays((sleepCall[2] as any).body)).toBe(60)
  })

  it('uses the median, not the mean, so a single outlier night does not move the baseline', async () => {
    mockRollups({
      restingHeartRate: [
        { civilStartTime: civil('2026-08-18'), bpm: 55 },
        { civilStartTime: civil('2026-08-19'), bpm: 56 },
        { civilStartTime: civil('2026-08-20'), bpm: 120 }, // one bad reading
      ],
    })

    const result = await getRecoveryData('user-1')

    // mean would be 77; the median ignores the outlier entirely
    expect(result).toMatchObject({ baselines: { restingHeartRate: 56 } })
  })

  it('drops dates where every metric came back null rather than padding the payload', async () => {
    mockRollups({
      restingHeartRate: [
        { civilStartTime: civil('2026-08-20'), bpm: 55 },
        { civilStartTime: civil('2026-08-21') }, // no numeric field at all
      ],
    })

    const result = await getRecoveryData('user-1')

    expect((result as { days: unknown[] }).days).toHaveLength(1)
  })

  // Sleep is a session record type, so one calendar day can carry a nap plus
  // a night. Minutes total; the score comes from the longest session.
  it('totals multiple sleep sessions per day and takes the score from the longest one', async () => {
    mockRollups({
      sleep: [
        { civilEndTime: civil('2026-08-20'), durationMinutes: 400, sleepScore: 88 },
        { civilEndTime: civil('2026-08-20'), durationMinutes: 25, sleepScore: 30 },
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ date: '2026-08-20', sleepMinutes: 425, sleepScore: 88 }] })
  })

  // "How did I sleep last night" means the night that ended this morning —
  // a session starting 23:40 would otherwise land on the previous day's row.
  it('credits a sleep session to the wake date, not the date it started', async () => {
    mockRollups({
      sleep: [{ civilStartTime: civil('2026-08-19'), civilEndTime: civil('2026-08-20'), durationMinutes: 420 }],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ date: '2026-08-20' }] })
  })
})

describe('getRecoveryData — partial failure', () => {
  it('returns the data types that succeeded when one of them errors', async () => {
    mockRollups({
      restingHeartRate: [{ civilStartTime: civil('2026-08-20'), bpm: 55 }],
      hrv: new Error('Google Health API 503: backend unavailable'),
      sleep: [{ civilEndTime: civil('2026-08-20'), durationMinutes: 420 }],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({
      status: 'ok',
      days: [{ date: '2026-08-20', restingHeartRate: 55, hrvMs: null, sleepMinutes: 420 }],
      unavailable: ['hrvMs'],
    })
  })

  it('omits `unavailable` entirely when everything succeeded', async () => {
    mockRollups({ restingHeartRate: [{ civilStartTime: civil('2026-08-20'), bpm: 55 }] })

    expect(await getRecoveryData('user-1')).not.toHaveProperty('unavailable')
  })

  it('reports an error only when all three data types fail', async () => {
    mockRollups({
      restingHeartRate: new Error('Google Health API 500: boom'),
      hrv: new Error('Google Health API 500: boom'),
      sleep: new Error('Google Health API 500: boom'),
    })

    expect(await getRecoveryData('user-1')).toEqual({ status: 'error', error: 'Google Health API 500: boom' })
  })
})

// Issue #59's "known unknown": Google's public docs never enumerate the
// per-data-type field names inside a rollup point. Nothing may assume one
// exact spelling, and a missing metric must degrade to null, never throw.
describe('getRecoveryData — unknown field-name resilience', () => {
  it('extracts a resting HR carrying an undocumented field name', async () => {
    mockRollups({
      restingHeartRate: [{ civilStartTime: civil('2026-08-20'), someUndocumentedRollupField: 57 }],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ restingHeartRate: 57 }] })
  })

  it('extracts a metric nested one level deeper under a plausible key', async () => {
    mockRollups({
      hrv: [{ civilStartTime: civil('2026-08-20'), hrvSummary: { avg: 48.2 } }],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ hrvMs: 48.2 }] })
  })

  // extractNumber's last-resort leaf scan would happily return a year or an
  // hour as a bpm if the civil-time fields weren't stripped first.
  it('never mistakes a civil-time component for a metric value', async () => {
    mockRollups({
      restingHeartRate: [{ civilStartTime: { ...civil('2026-08-20'), hours: 7, minutes: 30 }, civilEndTime: civil('2026-08-20') }],
    })

    const result = await getRecoveryData('user-1')

    expect((result as { days: unknown[] }).days).toHaveLength(0)
  })

  it('degrades to null instead of throwing on a completely unrecognizable point', async () => {
    mockRollups({
      restingHeartRate: [{ civilStartTime: civil('2026-08-20'), note: 'not a number' }],
      sleep: [{ civilEndTime: civil('2026-08-20'), stage: 'deep' }],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ status: 'ok', baselines: { restingHeartRate: null, hrvMs: null, sleepMinutes: null } })
  })
})

describe('sleepMinutesOf', () => {
  it('reads an explicit minutes field as-is', () => {
    expect(sleepMinutesOf({ sleepMinutes: 412 })).toBe(412)
  })

  // The one metric whose *scale* is genuinely ambiguous — 28800 is either a
  // nonsense number of minutes or a perfectly normal 8 hours in seconds.
  it('converts a seconds-scaled duration to minutes', () => {
    expect(sleepMinutesOf({ durationSeconds: 28800 })).toBe(480)
  })

  it('converts a millis-scaled duration to minutes', () => {
    expect(sleepMinutesOf({ durationMillis: 28800000 })).toBe(480)
  })

  it('rejects an out-of-range fallback number rather than reporting an absurd sleep total', () => {
    expect(sleepMinutesOf({ mysteryField: 28800 })).toBeNull()
  })

  it('accepts a plausible fallback number as minutes', () => {
    expect(sleepMinutesOf({ mysteryField: 430 })).toBe(430)
  })

  it('returns null when the point carries no number at all', () => {
    expect(sleepMinutesOf({ stage: 'rem' })).toBeNull()
  })
})

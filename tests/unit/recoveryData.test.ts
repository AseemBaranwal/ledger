import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRecoveryData } from '../../api/_lib/recoveryData'
import { getValidAccessToken, googleHealthRequest } from '../../api/_lib/googleHealth'

// Mocked at the googleHealth boundary — the same seam the real module owns
// (token handling + the authed request), so these tests exercise the actual
// parsing/aggregation/median/insight logic rather than a re-implementation
// of it.
//
// Every fixture shape below is copied from a REAL response captured against
// a live connected account (Pixel Watch 3 via Fitbit), not guessed — see the
// long comment at the top of recoveryData.ts for how the original
// implementation's assumptions (dailyRollUp, a bare {year,month,day} range,
// permissive field-name probing) turned out wrong the first time this was
// ever run against a live connection, and what the confirmed shapes are —
// including stagesSummary/minutesAwake/minutesInSleepPeriod/type, all
// confirmed present on a real live sleep point (issue #62).
vi.mock('../../api/_lib/googleHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/_lib/googleHealth')>()
  return { ...actual, getValidAccessToken: vi.fn(), googleHealthRequest: vi.fn() }
})

const okToken = { status: 'ok' as const, accessToken: 'tok' }

// Routes each dataPoints.list call to the right fixture by the data type in
// its path, so a test can supply just the types it cares about.
function mockDataPoints(byType: {
  restingHeartRate?: unknown[] | Error
  hrv?: unknown[] | Error
  sleep?: unknown[] | Error
}) {
  vi.mocked(googleHealthRequest).mockImplementation(async (_token: string, path: string) => {
    const key = path.includes('daily-resting-heart-rate')
      ? 'restingHeartRate'
      : path.includes('daily-heart-rate-variability')
        ? 'hrv'
        : 'sleep'
    const fixture = byType[key as keyof typeof byType]
    if (fixture instanceof Error) throw fixture
    return { dataPoints: fixture ?? [] }
  })
}

const civilDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function rhrPoint(date: string, beatsPerMinute: string | number) {
  return { dailyRestingHeartRate: { beatsPerMinute, date: civilDate(date) } }
}

function hrvPoint(date: string, averageHeartRateVariabilityMilliseconds: number) {
  return { dailyHeartRateVariability: { averageHeartRateVariabilityMilliseconds, date: civilDate(date) } }
}

// Real sleep points never carried civilStartTime/civilEndTime in practice
// (confirmed against a live connection, despite the field being documented)
// — only startTime/endTime + start/endUtcOffset. Tests exercise that real
// path, not the documented-but-unobserved civil-time one.
function sleepPoint(opts: {
  endTime: string
  endUtcOffset?: string
  minutesAsleep: string | number
  mainSleep?: boolean
  type?: string
  minutesAwake?: string | number
  minutesInSleepPeriod?: string | number
  stagesSummary?: Array<{ type: string; minutes: string | number }>
}) {
  return {
    sleep: {
      interval: { endTime: opts.endTime, endUtcOffset: opts.endUtcOffset ?? '0s' },
      type: opts.type,
      metadata: opts.mainSleep != null ? { mainSleep: opts.mainSleep } : undefined,
      summary: {
        minutesAsleep: opts.minutesAsleep,
        minutesAwake: opts.minutesAwake,
        minutesInSleepPeriod: opts.minutesInSleepPeriod,
        stagesSummary: opts.stagesSummary,
      },
    },
  }
}

// A real, confirmed-live "good" night: 438 asleep, 94 deep, 102 REM, 241
// light, 38 awake, minutesInSleepPeriod 477, STAGES, mainSleep.
function goodNight(date: string, endTime: string) {
  return sleepPoint({
    endTime,
    minutesAsleep: '438',
    minutesAwake: '38',
    minutesInSleepPeriod: '477',
    type: 'STAGES',
    mainSleep: true,
    stagesSummary: [
      { type: 'AWAKE', minutes: '38' },
      { type: 'LIGHT', minutes: '241' },
      { type: 'DEEP', minutes: '94' },
      { type: 'REM', minutes: '102' },
    ],
  })
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
    mockDataPoints({
      restingHeartRate: [rhrPoint('2026-08-20', '54'), rhrPoint('2026-08-21', '59')],
      hrv: [hrvPoint('2026-08-20', 62.34), hrvPoint('2026-08-21', 41.06)],
      sleep: [
        sleepPoint({ endTime: '2026-08-20T06:00:00Z', minutesAsleep: '431' }),
        sleepPoint({ endTime: '2026-08-21T06:00:00Z', minutesAsleep: '353' }),
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({
      status: 'ok',
      days: [
        { date: '2026-08-20', restingHeartRate: 54, hrvMs: 62.3, sleepMinutes: 431, sleepQualityIndex: null },
        { date: '2026-08-21', restingHeartRate: 59, hrvMs: 41.1, sleepMinutes: 353, sleepQualityIndex: null },
      ],
      // Baseline is history-only (every day except latest) — with just two
      // days total, that's the first day's own values, not a two-day
      // average of a set that includes the day being compared against.
      baselines: { restingHeartRate: 54, hrvMs: 62.3, sleepMinutes: 431, sleepQualityIndex: null },
      latest: { date: '2026-08-21', restingHeartRate: 59, hrvMs: 41.1, sleepMinutes: 353 },
    })
  })

  // beatsPerMinute and minutesAsleep are int64-typed on the wire, which
  // googleapis JSON serializes as a STRING (not a number) to avoid
  // precision loss — a real, confirmed convention, not a defensive guess.
  it('parses int64 wire fields serialized as strings', async () => {
    mockDataPoints({
      restingHeartRate: [rhrPoint('2026-08-20', '61')],
      sleep: [sleepPoint({ endTime: '2026-08-20T06:00:00Z', minutesAsleep: '415' })],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ restingHeartRate: 61, sleepMinutes: 415 }] })
  })

  it('calls dataPoints.list per data type, in parallel, with a date-range filter', async () => {
    mockDataPoints({})

    await getRecoveryData('user-1')

    expect(googleHealthRequest).toHaveBeenCalledTimes(3)
    const paths = vi.mocked(googleHealthRequest).mock.calls.map((c) => c[1] as string)
    expect(paths[0]).toContain('users/me/dataTypes/daily-resting-heart-rate/dataPoints?')
    expect(paths[0]).toContain('daily_resting_heart_rate.date')
    expect(paths[1]).toContain('users/me/dataTypes/daily-heart-rate-variability/dataPoints?')
    expect(paths[1]).toContain('daily_heart_rate_variability.date')
    expect(paths[2]).toContain('users/me/dataTypes/sleep/dataPoints?')
    expect(paths[2]).toContain('sleep.interval.civil_end_time')
  })

  it('uses the median, not the mean, so a single outlier night does not move the baseline', async () => {
    mockDataPoints({
      restingHeartRate: [rhrPoint('2026-08-18', '55'), rhrPoint('2026-08-19', '56'), rhrPoint('2026-08-20', '120')],
    })

    const result = await getRecoveryData('user-1')

    // mean would be 77; the median ignores the outlier entirely
    expect(result).toMatchObject({ baselines: { restingHeartRate: 56 } })
  })

  it('drops dates where every metric came back null rather than padding the payload', async () => {
    mockDataPoints({
      restingHeartRate: [
        rhrPoint('2026-08-20', '55'),
        { dailyRestingHeartRate: { date: civilDate('2026-08-21') } }, // no beatsPerMinute at all
      ],
    })

    const result = await getRecoveryData('user-1')

    expect((result as { days: unknown[] }).days).toHaveLength(1)
  })

  it('totals multiple sleep sessions per day (a nap plus a night)', async () => {
    mockDataPoints({
      sleep: [
        sleepPoint({ endTime: '2026-08-20T14:00:00Z', minutesAsleep: '25' }), // nap
        sleepPoint({ endTime: '2026-08-20T06:00:00Z', minutesAsleep: '400' }), // night
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ date: '2026-08-20', sleepMinutes: 425 }] })
  })

  // A session starting the evening before must credit the date it ended on
  // ("how did I sleep last night" means the night that ended this morning),
  // and the local date has to come from applying the UTC offset, not just
  // reading the UTC calendar date off the raw timestamp.
  it('credits a sleep session to the local wake date, applying the UTC offset', async () => {
    mockDataPoints({
      // 2026-08-20T02:00:00Z with a -7h offset is 2026-08-19 19:00 local —
      // if the offset weren't applied this would wrongly land on the 20th.
      sleep: [sleepPoint({ endTime: '2026-08-20T02:00:00Z', endUtcOffset: '-25200s', minutesAsleep: '420' })],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ date: '2026-08-19' }] })
  })
})

describe('getRecoveryData — sleep quality index', () => {
  it('computes a score from duration + efficiency + restoration for a real STAGES night', async () => {
    mockDataPoints({ sleep: [goodNight('2026-08-20', '2026-08-20T06:00:00Z')] })

    const result = await getRecoveryData('user-1')

    // duration: min(50, 438/480*50) = 45.625
    // efficiency: 438/477 = .9182 -> 25*clamp((.9182-.7)/.25) = 21.8
    // restoration: (94+102)/438 = .4475 -> 25*clamp((.4475-.15)/.25) = 25 (capped)
    // total ≈ 45.625 + 21.8 + 25 = 92.4 -> rounds to 92
    expect(result).toMatchObject({ days: [{ sleepQualityIndex: 92 }] })
  })

  it('returns null when the night is CLASSIC-type (no deep/REM breakdown)', async () => {
    mockDataPoints({
      sleep: [
        sleepPoint({
          endTime: '2026-08-20T06:00:00Z',
          minutesAsleep: '420',
          minutesAwake: '20',
          minutesInSleepPeriod: '440',
          type: 'CLASSIC',
          mainSleep: true,
          stagesSummary: [
            { type: 'AWAKE', minutes: '20' },
            { type: 'ASLEEP', minutes: '420' },
          ],
        }),
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ sleepQualityIndex: null }] })
  })

  it('returns null when efficiency inputs are missing entirely, rather than guessing', async () => {
    mockDataPoints({
      sleep: [
        sleepPoint({
          endTime: '2026-08-20T06:00:00Z',
          minutesAsleep: '420',
          type: 'STAGES',
          mainSleep: true,
          stagesSummary: [
            { type: 'DEEP', minutes: '80' },
            { type: 'REM', minutes: '90' },
          ],
        }),
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ days: [{ sleepQualityIndex: null }] })
  })

  it('ignores a nap for efficiency/type fields, using only the flagged main sleep', async () => {
    mockDataPoints({
      sleep: [
        // Nap: no mainSleep flag, no type — must not clobber the main
        // sleep's efficiency inputs.
        sleepPoint({ endTime: '2026-08-20T14:00:00Z', minutesAsleep: '20' }),
        goodNight('2026-08-20', '2026-08-20T06:00:00Z'),
      ],
    })

    const result = await getRecoveryData('user-1')

    // sleepMinutes sums both (438 + 20 = 458), but sleepQualityIndex still
    // computes off the main sleep's real 438/477/94/102 inputs, not
    // clobbered/blended with the nap's bare 20 minutes.
    expect(result).toMatchObject({ days: [{ sleepMinutes: 458, sleepQualityIndex: 92 }] })
  })
})

describe('getRecoveryData — deltas, flags, readiness', () => {
  it('flags an elevated resting heart rate, a dropped HRV, and short sleep as compromised', async () => {
    mockDataPoints({
      restingHeartRate: [
        rhrPoint('2026-08-17', '55'),
        rhrPoint('2026-08-18', '56'),
        rhrPoint('2026-08-19', '55'),
        rhrPoint('2026-08-20', '68'), // +13 vs baseline 55
      ],
      hrv: [
        hrvPoint('2026-08-17', 60),
        hrvPoint('2026-08-18', 62),
        hrvPoint('2026-08-19', 61),
        hrvPoint('2026-08-20', 40), // -34% vs baseline 61
      ],
      sleep: [
        sleepPoint({ endTime: '2026-08-17T06:00:00Z', minutesAsleep: '440' }),
        sleepPoint({ endTime: '2026-08-18T06:00:00Z', minutesAsleep: '430' }),
        sleepPoint({ endTime: '2026-08-19T06:00:00Z', minutesAsleep: '420' }),
        sleepPoint({ endTime: '2026-08-20T06:00:00Z', minutesAsleep: '270' }), // -160 vs baseline 430
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({
      latest: { date: '2026-08-20' },
      deltas: { restingHeartRate: 13, hrvPercent: -34, sleepMinutes: -160 },
      readiness: 'compromised',
    })
    const flags = (result as { flags: string[] }).flags
    expect(flags.some((f) => f.includes('Resting heart rate is 13 bpm above'))).toBe(true)
    expect(flags.some((f) => f.includes('HRV is 34% below'))).toBe(true)
    expect(flags.some((f) => f.includes('160 fewer minutes'))).toBe(true)
  })

  it('reports primed when HRV is meaningfully up and nothing else is concerning', async () => {
    mockDataPoints({
      hrv: [
        hrvPoint('2026-08-17', 50),
        hrvPoint('2026-08-18', 52),
        hrvPoint('2026-08-19', 51),
        hrvPoint('2026-08-20', 60), // +18% vs baseline 51
      ],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ readiness: 'primed' })
    const flags = (result as { flags: string[] }).flags
    expect(flags.some((f) => f.includes('good recovery signal'))).toBe(true)
  })

  it('reports normal with no flags when nothing crosses a threshold', async () => {
    mockDataPoints({
      restingHeartRate: [rhrPoint('2026-08-19', '55'), rhrPoint('2026-08-20', '56')],
      hrv: [hrvPoint('2026-08-19', 60), hrvPoint('2026-08-20', 61)],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ readiness: 'normal', flags: [] })
  })

  it('flags two or more consecutive reduced-sleep nights', async () => {
    mockDataPoints({
      sleep: [
        sleepPoint({ endTime: '2026-08-16T06:00:00Z', minutesAsleep: '440' }),
        sleepPoint({ endTime: '2026-08-17T06:00:00Z', minutesAsleep: '430' }),
        sleepPoint({ endTime: '2026-08-18T06:00:00Z', minutesAsleep: '350' }), // below 85% of baseline
        sleepPoint({ endTime: '2026-08-19T06:00:00Z', minutesAsleep: '340' }),
      ],
    })

    const result = await getRecoveryData('user-1')

    const flags = (result as { flags: string[] }).flags
    expect(flags.some((f) => f.includes('consecutive nights of reduced sleep'))).toBe(true)
  })

  it('returns null deltas/empty flags/null readiness when there is no data at all', async () => {
    mockDataPoints({})

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({ latest: null, deltas: null, flags: [], readiness: null })
  })
})

describe('getRecoveryData — partial failure', () => {
  it('returns the data types that succeeded when one of them errors', async () => {
    mockDataPoints({
      restingHeartRate: [rhrPoint('2026-08-20', '55')],
      hrv: new Error('Google Health API 503: backend unavailable'),
      sleep: [sleepPoint({ endTime: '2026-08-20T06:00:00Z', minutesAsleep: '420' })],
    })

    const result = await getRecoveryData('user-1')

    expect(result).toMatchObject({
      status: 'ok',
      days: [{ date: '2026-08-20', restingHeartRate: 55, hrvMs: null, sleepMinutes: 420 }],
      unavailable: ['hrvMs'],
    })
  })

  it('omits `unavailable` entirely when everything succeeded', async () => {
    mockDataPoints({ restingHeartRate: [rhrPoint('2026-08-20', '55')] })

    expect(await getRecoveryData('user-1')).not.toHaveProperty('unavailable')
  })

  it('reports an error only when all three data types fail', async () => {
    mockDataPoints({
      restingHeartRate: new Error('Google Health API 500: boom'),
      hrv: new Error('Google Health API 500: boom'),
      sleep: new Error('Google Health API 500: boom'),
    })

    expect(await getRecoveryData('user-1')).toEqual({ status: 'error', error: 'Google Health API 500: boom' })
  })
})

import {
  DATA_TYPE,
  MAX_RANGE_DAYS,
  civilDateToIso,
  extractNumber,
  getValidAccessToken,
  googleHealthRequest,
  toCivilDate,
  type CivilDate,
} from './googleHealth.js'

// Recovery/readiness data for the Coach — resting heart rate, HRV and sleep,
// pulled from Google Health (see issue #59) and flattened into one small
// per-day array plus baselines.
//
// Two constraints shape everything here:
//
// 1. This payload goes into an LLM context on every call that uses it, so it
//    stays deliberately tiny: one row per day, four numbers, rounded. No raw
//    rollup points, no per-sample arrays.
// 2. Google does not document the per-data-type field names inside a rollup
//    point ("known unknown" in issue #59). Nothing here assumes a single
//    field name — every metric goes through a preferred-keys probe and
//    degrades to null when absent. When the real names are discovered
//    against a live connection, only the *_KEYS arrays below need to change.

// Probe orders, most-specific first. extractNumber() tries exact matches,
// then any key *containing* one of these, then a single numeric leaf — so
// e.g. bpm / bpmAvg / avg_bpm are all covered by 'bpm' alone.
const RESTING_HR_KEYS = ['restingHeartRate', 'bpm', 'beatsPerMinute', 'heartRate', 'value']
const HRV_KEYS = ['rmssd', 'hrv', 'heartRateVariability', 'variability', 'value']
// Sleep duration is the one metric with a genuinely ambiguous *scale* (a
// number could be minutes, seconds, or millis), so it gets a stricter probe
// per scale before falling back — see sleepMinutesOf().
const SLEEP_MINUTE_KEYS = ['sleepMinutes', 'durationMinutes', 'totalSleepMinutes', 'asleepMinutes', 'minutes']
const SLEEP_SECOND_KEYS = ['durationSeconds', 'sleepSeconds', 'totalSleepSeconds', 'seconds', 'duration']
const SLEEP_MILLI_KEYS = ['durationMillis', 'durationMs', 'millis']
const SLEEP_SCORE_KEYS = ['sleepScore', 'score']

export interface RecoveryDay {
  date: string
  restingHeartRate: number | null
  hrvMs: number | null
  sleepMinutes: number | null
  sleepScore: number | null
}

export interface RecoveryBaselines {
  restingHeartRate: number | null
  hrvMs: number | null
  sleepMinutes: number | null
}

export type RecoveryResult =
  | { status: 'ok'; days: RecoveryDay[]; baselines: RecoveryBaselines; unavailable?: string[] }
  | { status: 'not_connected' }
  | { status: 'needs_reconnect'; reason: string }
  | { status: 'error'; error: string }

const DEFAULT_DAYS = 14

interface RollupPoint {
  civilStartTime?: CivilDate
  civilEndTime?: CivilDate
  [key: string]: unknown
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

// The civil-time fields are structural, not metrics — strip them before any
// numeric probe so extractNumber()'s deliberately permissive last-resort
// leaf scan can't return a year or an hour as if it were a bpm.
function metricFields(point: RollupPoint): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(point)) {
    if (/^civil/i.test(key) || /Time$/.test(key) || key === 'startTime' || key === 'endTime') continue
    out[key] = value
  }
  return out
}

// Strict probe (exact key, then key-contains) with no numeric-leaf fallback —
// used where picking the *wrong* number would be worse than picking none,
// i.e. sleep duration, where minutes/seconds/millis are indistinguishable
// once you're just grabbing whatever number is lying around.
function probeStrict(fields: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const direct = fields[key]
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  }
  for (const key of keys) {
    for (const actual of Object.keys(fields)) {
      if (actual.toLowerCase().includes(key.toLowerCase())) {
        const value = fields[actual]
        if (typeof value === 'number' && Number.isFinite(value)) return value
      }
    }
  }
  return null
}

export function sleepMinutesOf(point: RollupPoint): number | null {
  const fields = metricFields(point)
  const minutes = probeStrict(fields, SLEEP_MINUTE_KEYS)
  if (minutes != null) return minutes
  // Millis before seconds, deliberately: SLEEP_SECOND_KEYS includes the bare
  // 'duration', which substring-matches `durationMillis` too and would read
  // 8 hours as 480,000 minutes. Most specific scale first.
  const millis = probeStrict(fields, SLEEP_MILLI_KEYS)
  if (millis != null) return millis / 60000
  const seconds = probeStrict(fields, SLEEP_SECOND_KEYS)
  if (seconds != null) return seconds / 60
  // Last resort: whatever single number the point carries, read as minutes.
  // A plausible night's sleep in minutes (60–1000) is a very different
  // magnitude from the same night in seconds, so a wildly out-of-range value
  // is more likely a misread field than a real number — drop it rather than
  // feed the Coach a "you slept 28,800 minutes" line.
  const fallback = extractNumber(fields, SLEEP_MINUTE_KEYS)
  if (fallback != null && fallback > 0 && fallback < 1000) return fallback
  return null
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function round(value: number | null, decimals = 0): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

interface RollupFetch {
  points: RollupPoint[]
  error: string | null
}

async function fetchRollup(
  accessToken: string,
  dataType: string,
  start: Date,
  end: Date
): Promise<RollupFetch> {
  try {
    const body = {
      range: { start: toCivilDate(start), end: toCivilDate(end) },
      windowSizeDays: 1,
      pageSize: 1440,
    }
    const res = await googleHealthRequest(accessToken, `users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
      method: 'POST',
      body,
    })
    const points = Array.isArray(res?.rollupDataPoints) ? (res.rollupDataPoints as RollupPoint[]) : []
    return { points, error: null }
  } catch (e) {
    // One data type failing must not take the other two down with it —
    // partial recovery data is far more useful to the Coach than an error,
    // and "this watch never recorded HRV" is a normal, permanent state for
    // some devices rather than an outage.
    return { points: [], error: e instanceof Error ? e.message : `Could not read ${dataType}` }
  }
}

// Sleep is credited to the date you WOKE UP (civilEndTime), not the evening
// the session started — "how did I sleep last night" means the night that
// ended this morning, and a session starting at 23:40 would otherwise land
// on the previous day's row.
function dateKeyFor(point: RollupPoint, prefer: 'start' | 'end'): string | null {
  const first = prefer === 'end' ? point.civilEndTime : point.civilStartTime
  const second = prefer === 'end' ? point.civilStartTime : point.civilEndTime
  return civilDateToIso(first) || civilDateToIso(second)
}

export async function getRecoveryData(
  userId: string,
  opts?: { days?: number }
): Promise<RecoveryResult> {
  const token = await getValidAccessToken(userId)
  // All three states are real and routine — while the OAuth consent screen
  // is in Testing status, Google force-expires refresh tokens weekly, so
  // needs_reconnect is expected rather than exceptional.
  if (token.status === 'not_connected') return { status: 'not_connected' }
  if (token.status === 'needs_reconnect') return { status: 'needs_reconnect', reason: token.reason }

  try {
    const requested = opts?.days && opts.days > 0 ? Math.floor(opts.days) : DEFAULT_DAYS
    // Google rejects (400) an over-long range rather than clamping it
    // itself, and the two caps differ by data type: 14 days for the
    // heart-rate family, 90 for everything else.
    const windowDays = Math.min(requested, MAX_RANGE_DAYS.other)
    const hrDays = Math.min(windowDays, MAX_RANGE_DAYS.heartRate)

    const end = new Date()
    const hrStart = daysAgo(hrDays - 1)
    const sleepStart = daysAgo(windowDays - 1)

    const [rhr, hrv, sleep] = await Promise.all([
      fetchRollup(token.accessToken, DATA_TYPE.restingHeartRate, hrStart, end),
      fetchRollup(token.accessToken, DATA_TYPE.hrv, hrStart, end),
      fetchRollup(token.accessToken, DATA_TYPE.sleep, sleepStart, end),
    ])

    const failures = [rhr, hrv, sleep].filter((r) => r.error)
    if (failures.length === 3) {
      return { status: 'error', error: failures[0].error as string }
    }

    interface DayAccumulator {
      restingHeartRate: number | null
      hrvMs: number | null
      sleepMinutes: number | null
      sleepScore: number | null
      longestSleep: number
    }
    const byDate = new Map<string, DayAccumulator>()
    const dayFor = (date: string): DayAccumulator => {
      let day = byDate.get(date)
      if (!day) {
        day = { restingHeartRate: null, hrvMs: null, sleepMinutes: null, sleepScore: null, longestSleep: -1 }
        byDate.set(date, day)
      }
      return day
    }

    for (const point of rhr.points) {
      const date = dateKeyFor(point, 'start')
      if (!date) continue
      const value = extractNumber(metricFields(point), RESTING_HR_KEYS)
      if (value != null) dayFor(date).restingHeartRate = value
    }

    for (const point of hrv.points) {
      const date = dateKeyFor(point, 'start')
      if (!date) continue
      const value = extractNumber(metricFields(point), HRV_KEYS)
      if (value != null) dayFor(date).hrvMs = value
    }

    // Sleep is a session record type, so a single day can carry more than
    // one point (a nap, a split night). Total the minutes, and take the
    // score from the longest session — averaging two scores where one is a
    // 20-minute nap would misrepresent the night that actually mattered.
    for (const point of sleep.points) {
      const date = dateKeyFor(point, 'end')
      if (!date) continue
      const day = dayFor(date)
      const minutes = sleepMinutesOf(point)
      if (minutes != null) day.sleepMinutes = (day.sleepMinutes ?? 0) + minutes
      const score = probeStrict(metricFields(point), SLEEP_SCORE_KEYS)
      if (score != null && (minutes ?? 0) > day.longestSleep) {
        day.longestSleep = minutes ?? 0
        day.sleepScore = score
      }
    }

    const days: RecoveryDay[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({
        date,
        restingHeartRate: round(day.restingHeartRate),
        hrvMs: round(day.hrvMs, 1),
        sleepMinutes: round(day.sleepMinutes),
        sleepScore: round(day.sleepScore),
      }))
      // A date whose every metric came back null carries no information and
      // would just pad the payload.
      .filter((d) => d.restingHeartRate != null || d.hrvMs != null || d.sleepMinutes != null || d.sleepScore != null)

    // Median, not mean — one travel night or one missed-strap reading
    // shouldn't move the number the Coach compares today against.
    const baselines: RecoveryBaselines = {
      restingHeartRate: round(median(days.map((d) => d.restingHeartRate).filter((v): v is number => v != null))),
      hrvMs: round(median(days.map((d) => d.hrvMs).filter((v): v is number => v != null)), 1),
      sleepMinutes: round(median(days.map((d) => d.sleepMinutes).filter((v): v is number => v != null))),
    }

    // Names the metrics that genuinely couldn't be read this call, so the
    // Coach can say "no HRV data" rather than silently treating an outage
    // as "your HRV is fine".
    const unavailable = [
      rhr.error ? 'restingHeartRate' : null,
      hrv.error ? 'hrvMs' : null,
      sleep.error ? 'sleep' : null,
    ].filter((v): v is string => v != null)

    return unavailable.length ? { status: 'ok', days, baselines, unavailable } : { status: 'ok', days, baselines }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'Could not read recovery data.' }
  }
}

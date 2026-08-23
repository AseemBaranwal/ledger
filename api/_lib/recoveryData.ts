import {
  DATA_TYPE,
  civilDateToIso,
  civilDateTimeToIso,
  getValidAccessToken,
  googleHealthRequest,
  toCivilDate,
  type CivilDate,
  type CivilDateTime,
} from './googleHealth.js'

// Recovery/readiness data for the Coach — resting heart rate, HRV and sleep,
// pulled from Google Health (see issue #59) and flattened into one small
// per-day array plus baselines.
//
// This payload goes into an LLM context on every call that uses it, so it
// stays deliberately tiny: one row per day, three numbers, rounded. No raw
// data points, no per-sample arrays.
//
// Every field name and request shape below is CONFIRMED against the live
// v4 discovery doc (health.googleapis.com/$discovery/rest?version=v4) and a
// real connected account, not docs-only research — issue #59's original
// implementation used `dailyRollUp` with a bare {year,month,day} range and
// permissive field-name probing, both of which turned out to be wrong the
// first time this was ever run against a live connection:
//   - `dailyRollUp` is not a supported action for any of these three data
//     types at all (Google 400s: "DailyRollup is not supported for data
//     type X, but the following actions are supported: list, reconcile").
//     The real fetch is `GET .../dataPoints` with an AIP-160 `filter` query
//     param, not a POST body.
//   - `range.start`/`range.end` (where they DO apply, e.g. to `rollUp`) take
//     a `CivilDateTime { date: {year,month,day} }`, not a bare
//     {year,month,day} — see toCivilDate's own note in googleHealth.ts.
//   - The HRV data type id is `daily-heart-rate-variability`, not
//     `heart-rate-variability` (that id exists too, but is a different, raw
//     per-sample type with no daily aggregate).
//   - Response field names are exact, not guessable: `dailyRestingHeartRate
//     .beatsPerMinute`, `dailyHeartRateVariability
//     .averageHeartRateVariabilityMilliseconds`, `sleep.summary
//     .minutesAsleep` — all confirmed via the discovery doc's schemas.
//   - There is no "sleep score" anywhere in this API's data model — that's
//     a Fitbit-app-UI concept, not part of Google Health's schema. Dropped
//     entirely rather than always returning null for a field that can never
//     be filled in.
//   - Several numeric fields (`beatsPerMinute`, `minutesAsleep`) are typed
//     `int64` on the wire, which googleapis JSON serializes as a STRING to
//     avoid JS number-precision loss — `asNumber()` below handles both.

export interface RecoveryDay {
  date: string
  restingHeartRate: number | null
  hrvMs: number | null
  sleepMinutes: number | null
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
// The list endpoint's filter docs don't state a hard day-count cap the way
// dailyRollUp's did — this is just a sane ceiling so a large `days` request
// can't build an unbounded filter/page size.
const MAX_DAYS = 90

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function isoDate(d: Date): string {
  return civilDateToIso(toCivilDate(d)) as string
}

// AIP-160 filter grammar for a "daily summary" data type, confirmed from the
// dataPoints.list method's own filter parameter docs: `{field}.date >= "X"
// AND {field}.date < "Y"`, where `field` is the *underscored* conceptual
// type name (e.g. `daily_heart_rate_variability`), not the hyphenated path
// segment used in the URL.
function dailySummaryFilter(fieldPrefix: string, start: Date, end: Date): string {
  return `${fieldPrefix}.date >= "${isoDate(start)}" AND ${fieldPrefix}.date < "${isoDate(end)}"`
}

// Sleep is a session-type data type, filtered by its interval's civil end
// time rather than a `.date` field — also confirmed from the filter docs
// (sleep gets its own documented filter pattern, distinct from daily
// summaries: `sleep.interval.civil_end_time >= "X" AND ... < "Y"`).
function sleepFilter(start: Date, end: Date): string {
  return `sleep.interval.civil_end_time >= "${isoDate(start)}" AND sleep.interval.civil_end_time < "${isoDate(end)}"`
}

interface ListFetch<T> {
  points: T[]
  error: string | null
}

async function listDataPoints<T>(accessToken: string, dataType: string, filter: string): Promise<ListFetch<T>> {
  try {
    const qs = new URLSearchParams({ filter, pageSize: '200' })
    const res = await googleHealthRequest(accessToken, `users/me/dataTypes/${dataType}/dataPoints?${qs.toString()}`)
    const points = Array.isArray(res?.dataPoints) ? (res.dataPoints as T[]) : []
    return { points, error: null }
  } catch (e) {
    // One data type failing must not take the other two down with it —
    // partial recovery data is far more useful to the Coach than an error,
    // and "this watch never recorded HRV" is a normal, permanent state for
    // some devices rather than an outage.
    return { points: [], error: e instanceof Error ? e.message : `Could not read ${dataType}` }
  }
}

// int64-typed fields on this API serialize as JSON strings — a confirmed
// googleapis wire convention, not a defensive guess. Number(undefined/'')
// is NaN, so this still degrades to null cleanly for an absent field.
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

interface DailyRestingHeartRatePoint {
  dailyRestingHeartRate?: { beatsPerMinute?: string | number; date?: CivilDate }
}
interface DailyHrvPoint {
  dailyHeartRateVariability?: { averageHeartRateVariabilityMilliseconds?: number; date?: CivilDate }
}
interface SleepPoint {
  sleep?: {
    interval?: {
      civilEndTime?: CivilDateTime
      civilStartTime?: CivilDateTime
      endTime?: string
      endUtcOffset?: string
      startTime?: string
      startUtcOffset?: string
    }
    summary?: { minutesAsleep?: string | number }
  }
}

// `google-duration` wire format: a signed number of seconds followed by a
// literal "s", e.g. "-25200s" for UTC-7. Same sign convention as a real UTC
// offset (negative = behind UTC) — unlike JS's own getTimezoneOffset(),
// which this app's Strava mapping (api/_lib/stravaMapping.ts) already has
// to invert for that exact reason.
function parseGoogleDurationSeconds(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v.replace(/s$/, ''))
  return Number.isFinite(n) ? n : 0
}

// A live connection's sleep points carry startTime/endTime (RFC3339 UTC)
// and start/endUtcOffset, but NOT the civilStartTime/civilEndTime the
// discovery doc documents them as having — confirmed empirically against a
// real connection, where every single point omitted both fields. Derive the
// local calendar date ourselves: shift the UTC instant by the offset, then
// read the date off the shifted instant with UTC getters so the runtime's
// own local timezone can't reinterpret it a second time.
function localDateFromUtc(isoUtc: string | undefined, utcOffsetDuration: string | undefined): string | null {
  if (!isoUtc) return null
  const utcMs = Date.parse(isoUtc)
  if (!Number.isFinite(utcMs)) return null
  const shifted = new Date(utcMs + parseGoogleDurationSeconds(utcOffsetDuration) * 1000)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    const windowDays = Math.min(requested, MAX_DAYS)

    const end = new Date()
    const start = daysAgo(windowDays - 1)

    const [rhr, hrv, sleep] = await Promise.all([
      listDataPoints<DailyRestingHeartRatePoint>(
        token.accessToken,
        DATA_TYPE.restingHeartRate,
        dailySummaryFilter('daily_resting_heart_rate', start, end)
      ),
      listDataPoints<DailyHrvPoint>(
        token.accessToken,
        DATA_TYPE.hrv,
        dailySummaryFilter('daily_heart_rate_variability', start, end)
      ),
      listDataPoints<SleepPoint>(token.accessToken, DATA_TYPE.sleep, sleepFilter(start, end)),
    ])

    const failures = [rhr, hrv, sleep].filter((r) => r.error)
    if (failures.length === 3) {
      return { status: 'error', error: failures[0].error as string }
    }

    interface DayAccumulator {
      restingHeartRate: number | null
      hrvMs: number | null
      sleepMinutes: number | null
    }
    const byDate = new Map<string, DayAccumulator>()
    const dayFor = (date: string): DayAccumulator => {
      let day = byDate.get(date)
      if (!day) {
        day = { restingHeartRate: null, hrvMs: null, sleepMinutes: null }
        byDate.set(date, day)
      }
      return day
    }

    for (const point of rhr.points) {
      const d = point.dailyRestingHeartRate
      const date = civilDateToIso(d?.date ?? null)
      if (!date) continue
      const value = asNumber(d?.beatsPerMinute)
      if (value != null) dayFor(date).restingHeartRate = value
    }

    for (const point of hrv.points) {
      const d = point.dailyHeartRateVariability
      const date = civilDateToIso(d?.date ?? null)
      if (!date) continue
      const value = asNumber(d?.averageHeartRateVariabilityMilliseconds)
      if (value != null) dayFor(date).hrvMs = value
    }

    // Sleep is a session record, so a single calendar day can carry more
    // than one point (a nap, a split night) — minutes total for the day.
    // Credited to the date you WOKE UP (civilEndTime), not the evening the
    // session started, since "how did I sleep last night" means the night
    // that ended this morning.
    for (const point of sleep.points) {
      const s = point.sleep
      const iv = s?.interval
      const date =
        civilDateTimeToIso(iv?.civilEndTime ?? null) ||
        civilDateTimeToIso(iv?.civilStartTime ?? null) ||
        localDateFromUtc(iv?.endTime, iv?.endUtcOffset) ||
        localDateFromUtc(iv?.startTime, iv?.startUtcOffset)
      if (!date) continue
      const minutes = asNumber(s?.summary?.minutesAsleep)
      if (minutes != null) {
        const day = dayFor(date)
        day.sleepMinutes = (day.sleepMinutes ?? 0) + minutes
      }
    }

    const days: RecoveryDay[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({
        date,
        restingHeartRate: round(day.restingHeartRate),
        hrvMs: round(day.hrvMs, 1),
        sleepMinutes: round(day.sleepMinutes),
      }))
      // A date whose every metric came back null carries no information and
      // would just pad the payload.
      .filter((d) => d.restingHeartRate != null || d.hrvMs != null || d.sleepMinutes != null)

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

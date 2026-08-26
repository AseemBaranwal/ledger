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
import { supabaseAdmin } from './supabaseAdmin.js'

// Recovery/readiness data for the Coach — resting heart rate, HRV, sleep,
// and a derived sleep-quality index — pulled from Google Health (see issue
// #59) and pre-processed into a small, LLM-ready payload (see issue #62).
//
// Two deliberate design choices carried through this whole file:
//
// 1. This payload goes into an LLM context on every call that uses it, so
//    it stays small: rounded numbers, medians instead of raw samples, no
//    per-sample arrays.
// 2. The Coach should reason from PRE-COMPUTED facts, not raw numbers it
//    has to compare/subtract/judge itself — that's a real hallucination
//    surface (a model doing its own arithmetic on numbers in context can
//    get it wrong, or invent a trend that isn't really there). So this
//    module does the comparison-against-baseline and the "is this actually
//    worth mentioning" judgment server-side (`deltas`, `flags`,
//    `readiness`), and the raw `days` array stays available only for
//    specific historical lookups.
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
//   - There is no "sleep score" ANYWHERE in this API — confirmed twice: an
//     empty result searching the schema for anything named `*score*`, and
//     zero real hits searching the entire raw discovery doc text
//     case-insensitively for "score" (the only two matches are an unrelated
//     VO2-max field description and a device-capability enum comment — no
//     actual data field). It's a Fitbit-app-UI-only computation. This
//     module computes its OWN estimate instead — see
//     `computeSleepQualityIndex` — built from the same raw ingredients
//     Fitbit's published methodology uses (duration, efficiency, time in
//     deep/REM), which ARE exposed, but it is explicitly NOT Fitbit's
//     number and must never be described to the user as such.
//   - Several numeric fields (`beatsPerMinute`, `minutesAsleep`,
//     `stagesSummary[].minutes`, etc.) are typed `int64` on the wire, which
//     googleapis JSON serializes as a STRING to avoid JS number-precision
//     loss — `asNumber()` below handles both.
//   - `stagesSummary`, `minutesToFallAsleep`/`minutesAwake`/
//     `minutesInSleepPeriod`, and `type: 'STAGES'` are all CONFIRMED
//     populated on a real live sleep point from a Pixel Watch 3 (a real
//     night: 438 min asleep, 94 deep, 102 REM, 241 light, 38 awake,
//     `stagesStatus: 'SUCCEEDED'`) — not assumed from the schema alone.

export interface RecoveryDay {
  date: string
  restingHeartRate: number | null
  hrvMs: number | null
  sleepMinutes: number | null
  // Ledger's own estimate, 0-100 — see computeSleepQualityIndex. Null
  // whenever the night wasn't STAGES-type sleep (no deep/REM breakdown to
  // compute a restoration component from), not just whenever data is thin.
  sleepQualityIndex: number | null
}

export interface RecoveryBaselines {
  restingHeartRate: number | null
  hrvMs: number | null
  sleepMinutes: number | null
  sleepQualityIndex: number | null
}

export interface RecoveryDeltas {
  // Signed bpm, latest day vs baseline. Positive = elevated.
  restingHeartRate: number | null
  // Signed percent, latest day vs baseline. Negative = down.
  hrvPercent: number | null
  // Signed minutes, latest day vs baseline. Negative = slept less.
  sleepMinutes: number | null
}

export type Readiness = 'primed' | 'normal' | 'compromised'

export type RecoveryResult =
  | {
      status: 'ok'
      days: RecoveryDay[]
      baselines: RecoveryBaselines
      // The most recent day with any data — named `latest`, not `today`,
      // since a watch can lag a day or more before a night finishes
      // syncing. Saves the model from having to find "the last row" itself
      // (and getting date math wrong doing it).
      latest: RecoveryDay | null
      deltas: RecoveryDeltas | null
      // Short, factual, pre-written observations — only present when a
      // real documented threshold is crossed. Includes good signals, not
      // only concerning ones. The model should treat this as the primary
      // signal, not re-derive its own trend commentary from `days`.
      flags: string[]
      readiness: Readiness | null
      unavailable?: string[]
    }
  | { status: 'not_connected' }
  | { status: 'needs_reconnect'; reason: string }
  | { status: 'error'; error: string }

const DEFAULT_DAYS = 14
// The list endpoint's filter docs don't state a hard day-count cap the way
// dailyRollUp's did — this is just a sane ceiling so a large `days` request
// can't build an unbounded filter/page size.
const MAX_DAYS = 90

// Threshold constants for flags/readiness — kept as named values in one
// place, not scattered magic numbers, so they're auditable and easy to
// retune later without hunting through the logic.
const RHR_ELEVATED_BPM = 5
const RHR_HIGH_BPM = 10
const HRV_LOW_PCT = -10
const HRV_VERY_LOW_PCT = -20
const HRV_HIGH_PCT = 10
const SLEEP_SHORT_MIN = -60
const SLEEP_VERY_SHORT_MIN = -120
const REDUCED_SLEEP_STREAK_RATIO = 0.85

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
interface StageSummaryEntry {
  type?: string
  minutes?: string | number
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
    // 'STAGES' (LIGHT/DEEP/REM/AWAKE breakdown) or 'CLASSIC' (coarser
    // AWAKE/RESTLESS/ASLEEP only, no restoration signal). Confirmed present
    // on real Pixel Watch 3 data.
    type?: string
    summary?: {
      minutesAsleep?: string | number
      minutesAwake?: string | number
      minutesInSleepPeriod?: string | number
      stagesSummary?: StageSummaryEntry[]
    }
    // "the longest sleep session with stages within one day" per Google's
    // own schema description — used to pick which session's efficiency
    // fields represent the night, since minutesAwake/minutesInSleepPeriod
    // aren't meaningful to sum across a main sleep + a nap the same way
    // minutesAsleep is.
    metadata?: { mainSleep?: boolean }
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

// Best-effort side-effect cache — never lets a persistence failure break
// the actual response, same posture as api/chat/message.ts's logChatCall
// and bodyWeightData.ts's own upsert. Does NOT change what this function
// returns or how fresh it is; the Coach still always gets a live fetch.
// This exists purely so the Trends tab's Recovery domain and the Sheet
// export have real rows to read without needing Coach-grade freshness on
// every read — see google_health_recovery.sql's file comment.
async function upsertRecoveryDays(userId: string, days: RecoveryDay[]): Promise<void> {
  if (!days.length) return
  try {
    const rows = days.map((d) => ({
      user_id: userId,
      d: d.date,
      resting_heart_rate: d.restingHeartRate,
      hrv_ms: d.hrvMs,
      sleep_minutes: d.sleepMinutes,
      sleep_quality_index: d.sleepQualityIndex,
      synced_at: new Date().toISOString(),
    }))
    // See exchange.ts's note on why supabase-js needs the `any` cast here —
    // no generated Database type in this project, so payloads infer as never.
    await (supabaseAdmin().from('google_health_recovery') as any).upsert(rows, { onConflict: 'user_id,d' })
  } catch {
    // ignore — the fetched data still reaches the caller either way
  }
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

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

// Ledger's OWN estimate of sleep quality, 0-100 — NOT anything Google or
// Fitbit computes or exposes (see the file-level comment: confirmed absent
// from the entire API). Modeled on Fitbit's own publicly documented sleep
// score weighting — duration ~50%, efficiency ~25%, restoration ~25% — but
// built from raw fields THIS API does expose. The exact curves below are
// this app's own reasonable choices, not a reverse-engineered copy of
// Fitbit's undisclosed formula, so this must never be presented to the user
// as "your Fitbit/Google sleep score."
//
// Returns null (not a guessed partial score) whenever there isn't enough
// signal to compute a real restoration component — i.e. non-STAGES sleep,
// or missing efficiency inputs — rather than fabricate a number.
function computeSleepQualityIndex(day: {
  // Deliberately the MAIN sleep session's own minutesAsleep, not the day's
  // combined total (which can include a nap) — mixing a nap's minutes into
  // duration while efficiency/restoration stay scoped to the main session
  // alone would score them against inconsistent denominators.
  mainSleepMinutes: number | null
  minutesInSleepPeriod: number | null
  minutesAwake: number | null
  deepMinutes: number | null
  remMinutes: number | null
  sleepType: string | null
}): number | null {
  if (day.mainSleepMinutes == null || day.mainSleepMinutes <= 0) return null
  if (day.sleepType !== 'STAGES' || day.deepMinutes == null || day.remMinutes == null) return null

  const totalInBed =
    day.minutesInSleepPeriod ?? (day.minutesAwake != null ? day.mainSleepMinutes + day.minutesAwake : null)
  if (totalInBed == null || totalInBed <= 0) return null

  // Duration: 0-50, linear up to an 8h reference and capped there — more
  // sleep past 8h doesn't keep adding score, same as the published formula.
  const durationScore = Math.min(50, (day.mainSleepMinutes / 480) * 50)

  // Efficiency: 0-25, scaled so ~95%+ time-asleep-while-in-bed is full
  // score and ~70% or below is zero.
  const efficiency = day.mainSleepMinutes / totalInBed
  const efficiencyScore = 25 * clamp01((efficiency - 0.7) / 0.25)

  // Restoration: 0-25, scaled so a ~40% deep+REM share of total sleep is
  // full score and ~15% or below is zero — healthy adults typically run
  // roughly 33-45% combined deep+REM of total sleep time.
  const restorationRatio = (day.deepMinutes + day.remMinutes) / day.mainSleepMinutes
  const restorationScore = 25 * clamp01((restorationRatio - 0.15) / 0.25)

  return Math.round(durationScore + efficiencyScore + restorationScore)
}

function computeDeltas(latest: RecoveryDay | null, baselines: RecoveryBaselines): RecoveryDeltas | null {
  if (!latest) return null
  const restingHeartRate =
    latest.restingHeartRate != null && baselines.restingHeartRate != null
      ? round(latest.restingHeartRate - baselines.restingHeartRate)
      : null
  const hrvPercent =
    latest.hrvMs != null && baselines.hrvMs != null && baselines.hrvMs > 0
      ? round(((latest.hrvMs - baselines.hrvMs) / baselines.hrvMs) * 100)
      : null
  const sleepMinutes =
    latest.sleepMinutes != null && baselines.sleepMinutes != null
      ? round(latest.sleepMinutes - baselines.sleepMinutes)
      : null
  return { restingHeartRate, hrvPercent, sleepMinutes }
}

function computeFlags(deltas: RecoveryDeltas | null, days: RecoveryDay[], baselines: RecoveryBaselines): string[] {
  if (!deltas) return []
  const flags: string[] = []
  const windowLabel = `${Math.min(30, days.length)}-day`

  if (deltas.restingHeartRate != null && deltas.restingHeartRate >= RHR_ELEVATED_BPM) {
    flags.push(`Resting heart rate is ${deltas.restingHeartRate} bpm above your ${windowLabel} baseline.`)
  }
  if (deltas.hrvPercent != null && deltas.hrvPercent <= HRV_LOW_PCT) {
    flags.push(`HRV is ${Math.abs(deltas.hrvPercent)}% below your ${windowLabel} baseline.`)
  } else if (deltas.hrvPercent != null && deltas.hrvPercent >= HRV_HIGH_PCT) {
    flags.push(`HRV is ${deltas.hrvPercent}% above your ${windowLabel} baseline — a good recovery signal.`)
  }
  if (deltas.sleepMinutes != null && deltas.sleepMinutes <= SLEEP_SHORT_MIN) {
    flags.push(`Slept ${Math.abs(deltas.sleepMinutes)} fewer minutes than your ${windowLabel} baseline last night.`)
  }

  if (baselines.sleepMinutes != null) {
    let streak = 0
    for (let i = days.length - 1; i >= 0; i--) {
      const m = days[i].sleepMinutes
      if (m != null && m < baselines.sleepMinutes * REDUCED_SLEEP_STREAK_RATIO) streak++
      else break
    }
    if (streak >= 2) flags.push(`${streak} consecutive nights of reduced sleep.`)
  }

  return flags
}

function computeReadiness(deltas: RecoveryDeltas | null): Readiness | null {
  if (!deltas) return null
  let concern = 0
  if (deltas.restingHeartRate != null) {
    if (deltas.restingHeartRate >= RHR_HIGH_BPM) concern += 2
    else if (deltas.restingHeartRate >= RHR_ELEVATED_BPM) concern += 1
  }
  if (deltas.hrvPercent != null) {
    if (deltas.hrvPercent <= HRV_VERY_LOW_PCT) concern += 2
    else if (deltas.hrvPercent <= HRV_LOW_PCT) concern += 1
  }
  if (deltas.sleepMinutes != null) {
    if (deltas.sleepMinutes <= SLEEP_VERY_SHORT_MIN) concern += 2
    else if (deltas.sleepMinutes <= SLEEP_SHORT_MIN) concern += 1
  }
  if (concern >= 2) return 'compromised'
  if (concern === 1) return 'normal'
  if (deltas.hrvPercent != null && deltas.hrvPercent >= HRV_HIGH_PCT) return 'primed'
  return 'normal'
}

// Pure — the comparison-against-baseline/flags/readiness math, factored out
// so it can run on either a freshly live-fetched `days` array or one read
// back from the google_health_recovery cache (see the cache-check at the
// top of getRecoveryData below). Keeping this in exactly one place means
// the cache path can never silently drift from what a live fetch would
// have computed for the same days.
function buildRecoveryResult(days: RecoveryDay[], unavailable: string[] = []): RecoveryResult {
  // Median, not mean — one travel night or one missed-strap reading
  // shouldn't move the number the Coach compares today against. Computed
  // from HISTORY ONLY (every day except the latest) — including today's
  // own reading in its own baseline would partially dilute the very
  // number it's meant to be compared against, understating a real spike
  // or dip and, for a short reduced-sleep streak, can even mask the
  // streak's own flag by dragging the threshold down with it.
  const history = days.slice(0, -1)
  const baselines: RecoveryBaselines = {
    restingHeartRate: round(median(history.map((d) => d.restingHeartRate).filter((v): v is number => v != null))),
    hrvMs: round(median(history.map((d) => d.hrvMs).filter((v): v is number => v != null)), 1),
    sleepMinutes: round(median(history.map((d) => d.sleepMinutes).filter((v): v is number => v != null))),
    sleepQualityIndex: round(
      median(history.map((d) => d.sleepQualityIndex).filter((v): v is number => v != null))
    ),
  }

  const latest = days.length ? days[days.length - 1] : null
  const deltas = computeDeltas(latest, baselines)
  const flags = computeFlags(deltas, days, baselines)
  const readiness = computeReadiness(deltas)

  return unavailable.length
    ? { status: 'ok', days, baselines, latest, deltas, flags, readiness, unavailable }
    : { status: 'ok', days, baselines, latest, deltas, flags, readiness }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface CachedRecoveryRow {
  d: string
  resting_heart_rate: number | null
  hrv_ms: number | null
  sleep_minutes: number | null
  sleep_quality_index: number | null
}

// Reads whatever's already cached for the requested window — used both to
// decide freshness (does today's row exist?) and, once it does, to serve
// the response without a live Google round-trip at all. RHR/HRV/sleep are
// daily aggregates: a row already cached for today is exactly as fresh as
// fetching again right now would be (Google won't recompute a finished
// day's number mid-day), so this isn't a staleness tradeoff — the Coach
// gets identical numbers either way, just without paying for three
// redundant upstream calls when today's reading is already known.
async function readCachedRecoveryDays(userId: string, windowDays: number): Promise<RecoveryDay[]> {
  const since = daysAgo(windowDays - 1).toISOString().slice(0, 10)
  const { data } = await supabaseAdmin()
    .from('google_health_recovery')
    .select('d, resting_heart_rate, hrv_ms, sleep_minutes, sleep_quality_index')
    .eq('user_id', userId)
    .gte('d', since)
    .order('d', { ascending: true })
  return ((data as unknown as CachedRecoveryRow[]) || []).map((r) => ({
    date: r.d,
    restingHeartRate: r.resting_heart_rate != null ? Number(r.resting_heart_rate) : null,
    hrvMs: r.hrv_ms != null ? Number(r.hrv_ms) : null,
    sleepMinutes: r.sleep_minutes != null ? Number(r.sleep_minutes) : null,
    sleepQualityIndex: r.sleep_quality_index != null ? Number(r.sleep_quality_index) : null,
  }))
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

    // Skip the three live Google round-trips entirely once today's reading
    // is already cached — see readCachedRecoveryDays's comment for why
    // that's safe. Best-effort: a cache-read failure just falls through to
    // the normal live fetch below rather than failing the whole call.
    try {
      const cached = await readCachedRecoveryDays(userId, windowDays)
      if (cached.some((d) => d.date === todayIso())) {
        return buildRecoveryResult(cached)
      }
    } catch {
      // fall through to the live fetch
    }

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
      mainSleepMinutes: number | null
      deepMinutes: number | null
      remMinutes: number | null
      minutesAwake: number | null
      minutesInSleepPeriod: number | null
      sleepType: string | null
    }
    const byDate = new Map<string, DayAccumulator>()
    const dayFor = (date: string): DayAccumulator => {
      let day = byDate.get(date)
      if (!day) {
        day = {
          restingHeartRate: null,
          hrvMs: null,
          sleepMinutes: null,
          mainSleepMinutes: null,
          deepMinutes: null,
          remMinutes: null,
          minutesAwake: null,
          minutesInSleepPeriod: null,
          sleepType: null,
        }
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
      const day = dayFor(date)
      const summary = s?.summary

      const minutes = asNumber(summary?.minutesAsleep)
      if (minutes != null) day.sleepMinutes = (day.sleepMinutes ?? 0) + minutes

      // Stage minutes sum across every session that day (main sleep + any
      // nap), same policy as sleepMinutes itself — keeps one aggregation
      // rule for the whole day rather than two different ones.
      for (const stage of summary?.stagesSummary ?? []) {
        const stageMinutes = asNumber(stage.minutes)
        if (stageMinutes == null) continue
        if (stage.type === 'DEEP') day.deepMinutes = (day.deepMinutes ?? 0) + stageMinutes
        else if (stage.type === 'REM') day.remMinutes = (day.remMinutes ?? 0) + stageMinutes
      }

      // Efficiency inputs (minutesAwake, minutesInSleepPeriod) describe one
      // session, not a summable daily total — take them from whichever
      // session Google flags as the night's main sleep, ignoring naps for
      // these specifically.
      if (s?.metadata?.mainSleep) {
        const awake = asNumber(summary?.minutesAwake)
        const inPeriod = asNumber(summary?.minutesInSleepPeriod)
        if (minutes != null) day.mainSleepMinutes = minutes
        if (awake != null) day.minutesAwake = awake
        if (inPeriod != null) day.minutesInSleepPeriod = inPeriod
        if (s.type) day.sleepType = s.type
      }
    }

    const days: RecoveryDay[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({
        date,
        restingHeartRate: round(day.restingHeartRate),
        hrvMs: round(day.hrvMs, 1),
        sleepMinutes: round(day.sleepMinutes),
        sleepQualityIndex: computeSleepQualityIndex(day),
      }))
      // A date whose every metric came back null carries no information and
      // would just pad the payload.
      .filter((d) => d.restingHeartRate != null || d.hrvMs != null || d.sleepMinutes != null)

    await upsertRecoveryDays(userId, days)

    // Names the metrics that genuinely couldn't be read this call, so the
    // Coach can say "no HRV data" rather than silently treating an outage
    // as "your HRV is fine".
    const unavailable = [
      rhr.error ? 'restingHeartRate' : null,
      hrv.error ? 'hrvMs' : null,
      sleep.error ? 'sleep' : null,
    ].filter((v): v is string => v != null)

    return buildRecoveryResult(days, unavailable)
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'Could not read recovery data.' }
  }
}

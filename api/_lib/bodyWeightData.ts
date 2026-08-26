import {
  DATA_TYPE,
  civilDateTimeToIso,
  getValidAccessToken,
  rollUpDataPoints,
  toCivilDateTime,
  type CivilDateTime,
} from './googleHealth.js'
import { supabaseAdmin } from './supabaseAdmin.js'

// Body-weight history from Google Health (issue #70's follow-up) — pulled
// via `dailyRollUp`, not the `list`+filter pattern recoveryData.ts uses for
// sleep/RHR/HRV. Weight is one of the data types dailyRollUp DOES support
// (confirmed against the live discovery doc's DailyRollupDataPoint response
// schema, which documents a `weight` field), so this is the simpler of the
// two fetch shapes — one POST already returns a per-civil-day average
// instead of raw samples this module would otherwise have to bucket itself.
//
// Unlike recovery data, this module also PERSISTS what it fetches (see
// upsertWeightDays below) — every successful call is a best-effort side
// write into google_health_weight, so the DB table stays current as a
// byproduct of normal use (a Coach question, a Trends tab visit, a Sheet
// sync) rather than needing its own separate polling job. See
// supabase/google_health_weight.sql for why persistence is needed here at
// all when recovery data gets away with fetching live every time: the Sheet
// export needs actual historical rows to read incrementally, and a weight
// trend is worth a durable local record independent of any one fetch.

export interface WeightDay {
  date: string
  weightLb: number
}

export type WeightResult =
  | { status: 'ok'; days: WeightDay[]; latest: WeightDay | null }
  | { status: 'not_connected' }
  | { status: 'needs_reconnect'; reason: string }
  | { status: 'error'; error: string }

// Deliberately different from recovery data's own 14-day default — the
// Coach's body-weight grounding is meant to look at a short recent window
// (per issue #70: "the last six days"), not the longer trend window
// recovery baselines use. Callers building the Trends tab's graph or the
// Sheet-sync backlog pass their own wider `days` explicitly rather than
// relying on this default.
const DEFAULT_DAYS = 6
// Google's own stated cap for this data type's dailyRollUp range (see
// DailyRollUpDataPointsRequest's `range` field description in the discovery
// doc) — 90 days, not the 14-day ceiling that applies to heart-rate/
// active-minutes/total-calories specifically.
const MAX_DAYS = 90

const GRAMS_PER_LB = 453.59237

function gramsToLb(grams: number): number {
  return grams / GRAMS_PER_LB
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

interface DailyRollupWeightPoint {
  civilStartTime?: CivilDateTime
  civilEndTime?: CivilDateTime
  weight?: { weightGramsAvg?: number }
}

// Best-effort — never lets a persistence failure break the actual response,
// same posture as api/chat/message.ts's logChatCall. Upserts on the (user,
// date) primary key so a re-fetch of an overlapping window just refreshes
// already-stored days rather than erroring or duplicating.
async function upsertWeightDays(userId: string, days: WeightDay[]): Promise<void> {
  if (!days.length) return
  try {
    const rows = days.map((d) => ({ user_id: userId, d: d.date, weight_lb: d.weightLb, synced_at: new Date().toISOString() }))
    // See exchange.ts's note on why supabase-js needs the `any` cast here —
    // no generated Database type in this project, so payloads infer as never.
    await (supabaseAdmin().from('google_health_weight') as any).upsert(rows, { onConflict: 'user_id,d' })
  } catch {
    // ignore — the fetched data still reaches the caller either way
  }
}

export async function getBodyWeightData(userId: string, opts?: { days?: number }): Promise<WeightResult> {
  const token = await getValidAccessToken(userId)
  // Same three routine states as recovery data — while the OAuth consent
  // screen is in Testing status, needs_reconnect is expected weekly, not a
  // failure.
  if (token.status === 'not_connected') return { status: 'not_connected' }
  if (token.status === 'needs_reconnect') return { status: 'needs_reconnect', reason: token.reason }

  try {
    const requested = opts?.days && opts.days > 0 ? Math.floor(opts.days) : DEFAULT_DAYS
    const windowDays = Math.min(requested, MAX_DAYS)

    const end = new Date()
    const start = daysAgo(windowDays)

    const res = await rollUpDataPoints(token.accessToken, DATA_TYPE.weight, {
      start: toCivilDateTime(start),
      end: toCivilDateTime(end),
    })

    const points = Array.isArray(res?.rollupDataPoints) ? (res.rollupDataPoints as DailyRollupWeightPoint[]) : []

    const days: WeightDay[] = points
      .map((p) => {
        const date = civilDateTimeToIso(p.civilStartTime ?? null)
        const grams = p.weight?.weightGramsAvg
        // A day with no scale reading at all comes back with no `weight`
        // field rather than a zero — skip it instead of plotting a 0 lb day.
        if (!date || typeof grams !== 'number' || !Number.isFinite(grams)) return null
        return { date, weightLb: round1(gramsToLb(grams)) }
      })
      .filter((d): d is WeightDay => d != null)
      .sort((a, b) => a.date.localeCompare(b.date))

    await upsertWeightDays(userId, days)

    const latest = days.length ? days[days.length - 1] : null
    return { status: 'ok', days, latest }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'Could not read body-weight data.' }
  }
}

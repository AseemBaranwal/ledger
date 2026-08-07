import type { Session, Exercise } from '@/types'
import { iso } from './dateUtils'
import { displayWeight, isWeightUnit, type UnitSystem } from './units'

export function calculateVolume(exercise: Exercise, totalReps: number): number {
  if (!exercise.ws || exercise.ws.length === 0) {
    return (exercise.w || 0) * totalReps
  }
  const avgWeight = exercise.ws.reduce((a, b) => a + b, 0) / exercise.ws.length
  return avgWeight * totalReps
}

export function getMaxWeight(exercise: Exercise): number {
  if (!exercise.ws || exercise.ws.length === 0) {
    return exercise.w || 0
  }
  return Math.max(...exercise.ws)
}

// Pairs each set's own weight with its own rep count ("55×6, 55×6, 60×7")
// instead of two separate comma lists ("55,55,60 × 6,6,7") that have to be
// mentally zipped together to read — used anywhere a "last performance"
// summary is shown (ExerciseLogger's collapsed row and "Last:" line,
// TodayTab's week-preview list).
// `system` only converts when `unit` is a real weight unit ('lb'/'+lb') —
// bodyweight ('reps') and measurement ('in') exercises are never touched,
// and callers that don't know the exercise's unit (unit omitted) always
// get the raw stored number back, matching this function's original
// behavior before unit-system support existed.
export function formatLastSets(e: Exercise, unit?: string, system: UnitSystem = 'imperial'): string {
  const convert = system === 'metric' && !!unit && isWeightUnit(unit)
  return e.r
    .map((r, i) => {
      const raw = e.ws ? e.ws[i] : e.w
      if (typeof raw !== 'number') return `${r}`
      const w = convert ? displayWeight(raw, system) : raw
      return `${w}${unit === '+lb' ? '+' : ''}×${r}`
    })
    .join(', ')
}

// Total lb volume for one session — sum(reps * weight) per set
export function volume(s: Session): number {
  return (s.ex || []).reduce((t, e) => {
    const setVols = e.r.map((r, i) => {
      const w = e.ws ? e.ws[i] || 1 : e.w || 1
      return r * w
    })
    return t + setVols.reduce((a, v) => a + v, 0)
  }, 0)
}

// Find the most recent prior logging of an exercise code
export function lastOf(sessions: Session[], code: string): (Exercise & { d: string }) | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const e = sessions[i].ex?.find((x) => x.k === code)
    if (e && e.r.length) return { ...e, d: sessions[i].d }
  }
  return null
}

// The weight dialed in for a code the last time it appeared in any
// session's exercise list — unlike lastOf, this does NOT require the
// exercise to have actually had a set logged (e.w tracks the stepper's
// current value even before a rep is logged), which is what a session
// starting mid-workout wants: carry forward whatever weight was last
// dialed in, not just the last completed set's weight.
export function lastDialedWeight(sessions: Session[], code: string): number | undefined {
  const last = sessions.length
    ? [...sessions].reverse().flatMap((s) => s.ex || []).find((x) => x.k === code)
    : null
  return last?.w ?? undefined
}

// Consecutive weeks (most recent first) with >= 3 logged sessions
export function streak(sessions: Session[]): number {
  const wk: Record<string, number> = {}
  sessions.forEach((s) => {
    const d = new Date(s.d + 'T12:00')
    const t = new Date(d)
    t.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    wk[iso(t)] = (wk[iso(t)] || 0) + 1
  })
  const keys = Object.keys(wk).sort().reverse()
  let n = 0
  for (const k of keys) {
    if (wk[k] >= 3) n++
    else break
  }
  return n
}

// Exercise codes that hit a new max weight in this session, vs all prior sessions
export function checkPRs(session: Session, allSessions: Session[]): string[] {
  const prs: string[] = []
  session.ex?.forEach((e) => {
    if (!e.r.length) return
    const curMax = e.ws ? Math.max(...e.ws) : e.w || 0
    const prior = allSessions
      .filter((x) => x !== session && x.d < session.d)
      .flatMap((x) => x.ex?.filter((y) => y.k === e.k) || [])
      .map((y) => (y.ws ? Math.max(...y.ws) : y.w || 0))
    if (prior.length && curMax > Math.max(...prior)) prs.push(e.k)
  })
  return prs
}

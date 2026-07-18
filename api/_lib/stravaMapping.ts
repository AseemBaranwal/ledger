// Maps a Ledger PROGRAM session code to the closest Strava sport_type.
// Only covers what's actually pushed to Strava today (weight-training
// PROGRAM sessions, matching the same scope as the Sheet push) — rest-day
// cardio activities (Easy Run, Skating) aren't included here yet.
//
// Worth double-checking against Strava's current API docs if this ever
// looks wrong: https://developers.strava.com/docs/reference/#api-models-SportType
// Their enum has changed over time; these four values are the
// well-established, unlikely-to-have-moved ones.
const SPORT_TYPE_BY_CODE: Record<string, string> = {
  LA: 'WeightTraining',
  PU: 'WeightTraining',
  PL: 'WeightTraining',
  LB: 'WeightTraining',
  SP: 'Run',
}

export function sportTypeForCode(code: string): string {
  return SPORT_TYPE_BY_CODE[code] || 'Workout'
}

interface ExerciseLike {
  k: string
  r: number[]
  ws?: number[]
  w?: number | null
}

// Ledger doesn't track actual elapsed time (only sets/reps/weight), so this
// is a rough estimate — Strava requires *some* elapsed_time for a manual
// activity. ~2.5 min/set blends typical working + rest time for a
// resistance session; clamped to a sane range so a 2-set or 40-set session
// doesn't produce something absurd.
export function estimateElapsedSeconds(exercises: ExerciseLike[]): number {
  const totalSets = exercises.reduce((sum, e) => sum + e.r.length, 0)
  const estimate = totalSets * 150
  return Math.min(Math.max(estimate, 20 * 60), 120 * 60)
}

export function buildActivityDescription(exercises: ExerciseLike[], notes: string | undefined): string {
  const lines = exercises.map((e) => {
    const sets = e.r.map((r, i) => {
      const w = e.ws ? e.ws[i] : e.w
      return w ? `${w}×${r}` : `${r}`
    })
    return `${e.k}: ${sets.join(', ')}`
  })
  if (notes) lines.push('', notes)
  return lines.join('\n')
}

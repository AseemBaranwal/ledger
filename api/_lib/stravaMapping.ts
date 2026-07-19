import { STRAVA_EXERCISE_TYPES } from './stravaExerciseCatalog.js'

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

// Strava's structured-sets JSON upload (see stravaExerciseCatalog.ts) is
// only accepted for these sport types — anything else (e.g. Run, for sprint
// sessions) has to go through the plain activity-with-description path.
const JSON_UPLOAD_SPORT_TYPES = new Set(['WeightTraining', 'HighIntensityIntervalTraining', 'Workout', 'Crossfit'])

export function supportsStructuredSets(sportType: string): boolean {
  return JSON_UPLOAD_SPORT_TYPES.has(sportType)
}

// Maps each of Ledger's own exercise codes (from config.json's program
// definitions) to the closest Strava exercise_type. Verified by hand against
// developers.strava.com/docs/uploads/ — where the movement's implement
// (barbell/dumbbell/cable/machine) isn't obvious from Ledger's data alone,
// this was confirmed directly with the user rather than guessed.
const LEDGER_EXERCISE_TO_STRAVA_TYPE: Record<string, string> = {
  // Lower A
  SQ: 'BARBELL_BACK_SQUAT',
  BSS: 'DUMBBELL_BULGARIAN_SPLIT_SQUATS',
  RDL: 'BARBELL_ROMANIAN_DEADLIFT',
  WL: 'DUMBBELL_WALKING_LUNGES',
  SCR: 'STANDING_CALF_RAISE',
  SEC: 'SEATED_CALF_RAISE',
  HLR: 'HANGING_LEG_RAISE',
  // Push
  OHP: 'STANDING_BARBELL_PRESS',
  DBL: 'LATERAL_RAISE_GENERIC', // Strava has no plain dumbbell lateral raise variant
  CLR: 'CABLE_LATERAL_RAISE',
  RDF: 'DUMBBELL_REAR_DELT_FLY',
  IDP: 'INCLINE_DUMBBELL_BENCH_PRESS',
  OTE: 'OVERHEAD_DUMBBELL_TRICEPS_EXTENSION',
  // Pull
  WPU: 'WEIGHTED_CHIN_UP',
  LPD: 'LAT_PULLDOWN', // Strava has no wide-grip-specific variant
  CSR: 'CHEST_SUPPORTED_ROW',
  FP: 'FACE_PULL',
  SHR: 'SHRUG_GENERIC', // Strava has no plain dumbbell shrug variant
  BC: 'CABLE_BICEPS_CURL',
  // Lower B
  HT: 'BARBELL_HIP_THRUST',
  EHC: 'MACHINE_LEG_CURL_SEATED',
  SU: 'STEP_UP',
  BJ: 'BOX_JUMP',
  SLC: 'SINGLE_LEG_STANDING_CALF_RAISE',
  CC: 'CABLE_CRUNCH',
  DF: 'DRAGON_FLAG',
}

// Falls back to a category-neutral generic rather than throwing — an
// unmapped code (e.g. a new exercise added to config.json, or a fully
// custom one-off logged from the exercise picker) shouldn't break the whole
// upload, just post with a less specific exercise icon.
export function stravaExerciseTypeForCode(code: string): string {
  // Codes picked from the exercise-swap picker's Strava catalog search ARE
  // already a valid Strava exercise_type (e.g. "LEG_PRESS") — no hand
  // mapping needed, it maps to itself.
  if (STRAVA_EXERCISE_TYPES.has(code)) return code
  const mapped = LEDGER_EXERCISE_TO_STRAVA_TYPE[code]
  if (mapped && STRAVA_EXERCISE_TYPES.has(mapped)) return mapped
  console.error('stravaExerciseTypeForCode: no mapping for code', code)
  return 'CORE_GENERIC'
}

const LB_TO_KG = 0.45359237

interface ExerciseLike {
  k: string
  n?: string
  r: number[]
  ws?: number[]
  w?: number | null
}

export interface StravaSet {
  exercise_type: string
  repetitions: number
  weight?: number
}

// Flattens Ledger's per-exercise rep/weight arrays into Strava's flat sets
// array — one set object per set, in order, across all exercises. Weight is
// converted from Ledger's lb to Strava's required kg, and omitted entirely
// (not sent as 0) for bodyweight sets with no tracked weight.
export function buildStravaSets(exercises: ExerciseLike[]): StravaSet[] {
  const sets: StravaSet[] = []
  for (const e of exercises) {
    const exerciseType = stravaExerciseTypeForCode(e.k)
    e.r.forEach((reps, i) => {
      const lb = e.ws ? e.ws[i] : e.w
      const set: StravaSet = { exercise_type: exerciseType, repetitions: reps }
      if (typeof lb === 'number') set.weight = Math.round(lb * LB_TO_KG * 100) / 100
      sets.push(set)
    })
  }
  return sets
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

// Prefers the app's own recorded start/end timestamps (set when the user
// actually tapped "Start" and saved the session) over the noon-placeholder +
// set-count estimate used previously. Falls back to the estimate whenever
// real timing is missing (older sessions logged before this existed) or
// looks implausible (clock skew, a draft left open for days) — clamped to
// the same kind of sane range as the estimate, just wider since a real
// session can legitimately run longer than the heuristic assumed.
export function resolveTiming(
  date: string,
  exercises: ExerciseLike[],
  startTime?: string,
  endTime?: string
): { startTimeIso: string; elapsedSeconds: number } {
  const start = startTime ? new Date(startTime) : null
  const end = endTime ? new Date(endTime) : null
  const validRange = start && end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start

  if (validRange) {
    const elapsed = Math.round((end!.getTime() - start!.getTime()) / 1000)
    if (elapsed >= 60 && elapsed <= 4 * 60 * 60) {
      return { startTimeIso: start!.toISOString(), elapsedSeconds: elapsed }
    }
  }
  return { startTimeIso: `${date}T12:00:00Z`, elapsedSeconds: estimateElapsedSeconds(exercises) }
}

export function buildActivityDescription(exercises: ExerciseLike[], notes: string | undefined): string {
  const lines = exercises.map((e) => {
    const sets = e.r.map((r, i) => {
      const w = e.ws ? e.ws[i] : e.w
      return w ? `${w}×${r}` : `${r}`
    })
    return `${e.n || e.k}: ${sets.join(', ')}`
  })
  if (notes) lines.push('', notes)
  return lines.join('\n')
}

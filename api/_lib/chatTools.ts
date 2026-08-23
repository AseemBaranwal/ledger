import { supabaseAdmin } from './supabaseAdmin.js'
import { resolveExerciseQuery } from './exerciseCatalog.js'
import type { ToolDefinition } from './anthropic.js'

// get_recovery_data's handler lives in recoveryData.ts (all the Google
// Health fetching/normalizing is there) but is re-exported here so the tool
// loop in api/chat/message.ts imports every tool handler from one place,
// same as the training-data and swap handlers below.
export { getRecoveryData } from './recoveryData.js'
export type { RecoveryResult, RecoveryDay, RecoveryBaselines } from './recoveryData.js'

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_training_data',
    description:
      "Reads the owner's logged training sessions. Always call this before answering any question about current weights, trends, or PRs — never answer from memory. Returns a compact list of recent sessions, each row carrying both the exercise code and its real exerciseName from the owner's own program — always use that exerciseName verbatim (e.g. for suggest_exercise_adjustment) rather than guessing a name from the code, since abbreviations like \"SLC\" or \"SU\" are genuinely ambiguous and guessing produces wrong names. Also returns the real current date as `today` (use this for any this-week/last-week reasoning — don't infer today's date from the most recent session row), and activeSwaps (only present if non-empty) listing any exercise currently substituted via an earlier accepted suggest_exercise_swap — trust this as the ground truth for what's currently swapped in, rather than inferring it from earlier turns in this conversation. A set in the sets string may carry a trailing (e)/(o)/(h) for easy/ok/hard — a real effort tag the owner gave that specific set at the time; a set with no suffix simply wasn't tagged, not necessarily 'ok'. Use tagged effort directly when it's there instead of inferring difficulty from rep counts alone. A row may also carry notes — whatever the owner wrote down for that session (form, energy, anything worth remembering) — attached once per session on its first row, not repeated on every row. Ground observations in these notes directly rather than guessing at context the owner already told you.",
    input_schema: {
      type: 'object',
      properties: {
        exerciseCode: {
          type: 'string',
          description: 'Optional exercise code (e.g. "SQ", "BSS") to filter to just that exercise across all sessions.',
        },
        sinceDate: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD). Only sessions on or after this date are returned.',
        },
        limit: {
          type: 'number',
          description: 'Max number of most-recent sessions to return. Defaults to 12 if omitted.',
        },
      },
    },
  },
  {
    name: 'get_recovery_data',
    description:
      "Reads recovery/readiness data recorded by the owner's watch — resting heart rate, HRV (in ms), sleep duration (in minutes) and sleep score, one row per day, plus `baselines` (the median of each metric across the window, so you can compare today against typical without doing the math yourself). Call this when the question is about readiness, fatigue, whether to push hard or back off today, or during a weekly check-in — not for questions purely about weights or logged sets. This data may legitimately be unavailable: `status` comes back as `not_connected` (the owner never linked their watch) or `needs_reconnect` (access expired — normal, it lapses about weekly by design). Both are ordinary states, NOT errors: when you get one, simply coach from training data alone and mention in a single short clause that recovery data isn't connected right now. Do not apologize at length, do not retry, and never treat it as something broken. A response may also carry `unavailable`, naming metrics that couldn't be read this time — say so plainly rather than treating a missing metric as a normal reading.",
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many days back to look. Defaults to 14 if omitted; heart-rate metrics are capped at 14 days by the upstream API regardless.',
        },
      },
    },
  },
  {
    name: 'suggest_exercise_adjustment',
    description:
      "Proposes a new target weight, reps, and/or sets for one exercise — include only the field(s) that should change. This does NOT change anything by itself — it only records a suggestion the owner will review and accept themselves in the app. Never claim the change has actually been applied.",
    input_schema: {
      type: 'object',
      properties: {
        exerciseCode: { type: 'string', description: 'The exercise code, e.g. "SQ".' },
        exerciseName: { type: 'string', description: 'The human-readable exercise name, e.g. "Back Squat".' },
        currentWeight: { type: 'number', description: 'Current target weight in lb, from the training data. Omit if not proposing a weight change.' },
        suggestedWeight: { type: 'number', description: 'Proposed new weight in lb. Omit if not proposing a weight change.' },
        currentReps: { type: 'number', description: 'Current target reps per set. Omit if not proposing a reps change.' },
        suggestedReps: { type: 'number', description: 'Proposed new target reps per set. Omit if not proposing a reps change.' },
        currentSets: { type: 'number', description: 'Current target number of sets. Omit if not proposing a sets change.' },
        suggestedSets: { type: 'number', description: 'Proposed new target number of sets. Omit if not proposing a sets change.' },
        reasoning: { type: 'string', description: 'One or two sentences on why this change makes sense right now.' },
      },
      required: ['exerciseCode', 'exerciseName', 'reasoning'],
    },
  },
  {
    name: 'suggest_exercise_swap',
    description:
      'Proposes replacing one exercise with a compatible alternate — e.g. leg press instead of a barbell squat if equipment isn\'t available or the owner wants a change. Describe the replacement in plain words (e.g. "leg press", "seated calf raise") — the exact catalog code is resolved server-side, you do not need to know it. This does NOT change anything by itself; it records a suggestion the owner reviews and accepts themselves.',
    input_schema: {
      type: 'object',
      properties: {
        currentExerciseCode: { type: 'string', description: 'The code of the exercise being replaced, e.g. "SQ".' },
        currentExerciseName: { type: 'string', description: 'Human-readable name of the exercise being replaced.' },
        replacementQuery: { type: 'string', description: 'Plain-language description of the desired replacement, e.g. "leg press".' },
        reasoning: { type: 'string', description: 'One or two sentences on why this swap makes sense.' },
      },
      required: ['currentExerciseCode', 'currentExerciseName', 'replacementQuery', 'reasoning'],
    },
  },
]

interface SheetExercise {
  k: string
  r: number[]
  ws?: number[]
  w?: number | null
  ef?: Array<'e' | 'o' | 'h' | null>
}

interface SheetSession {
  d: string
  s?: string
  ex?: SheetExercise[]
  n?: string
}

interface TrainingDataRow {
  date: string
  session: string
  exercise: string
  exerciseName: string
  sets: string
  topWeight: number | null
  notes?: string
}

export function topWeightOf(ex: SheetExercise): number | null {
  if (ex.ws && ex.ws.length) {
    const weights = ex.ws.filter((w): w is number => typeof w === 'number')
    return weights.length ? Math.max(...weights) : null
  }
  return typeof ex.w === 'number' ? ex.w : null
}

export function formatSets(ex: SheetExercise): string {
  return ex.r
    .map((reps, i) => {
      const w = ex.ws ? ex.ws[i] : ex.w
      const base = typeof w === 'number' ? `${w}x${reps}` : `${reps}`
      // Only append a suffix for sets the owner actually tagged — most
      // sets (all historical ones, and any set today's owner skips
      // tagging) have no effort recorded, and leaving those bare keeps
      // the string from bloating with a marker that means nothing.
      const effort = ex.ef?.[i]
      return effort ? `${base}(${effort})` : base
    })
    .join(',')
}

interface ActiveSwap {
  originalCode: string
  currentCode: string
  currentName: string
}

// Reads the owner's standing exercise substitutions from their profile, and
// their logged sessions directly from Supabase's `sessions` table (see
// supabase/sessions.sql) — the same table sessionStore.ts writes to
// client-side, just queried from the backend so tool results are grounded
// in real data rather than trusting anything the client sends.
//
// Including activeSwaps here (not a separate tool) matters for a specific
// failure mode caught in live testing: without knowing whether an earlier
// swap suggestion actually took effect, the model would sometimes hedge —
// describing a suggestion in prose ("queued... ready to accept") instead of
// actually calling suggest_exercise_swap again, because it wasn't sure if
// a duplicate was needed. Since this tool is already called before any
// claim about current state (per the system prompt), giving it the ground
// truth here removes the uncertainty at the source rather than just
// instructing the model not to hedge.
export async function getTrainingData(
  ownerUserId: string,
  args: { exerciseCode?: string; sinceDate?: string; limit?: number }
): Promise<{ rows: TrainingDataRow[]; today: string; activeSwaps?: ActiveSwap[] } | { error: string }> {
  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('exercise_substitutions, routine_config')
    .eq('id', ownerUserId)
    .single()

  const substitutions = (profile as { exercise_substitutions?: Record<string, { code: string; name: string }> } | null)?.exercise_substitutions || {}
  const activeSwaps: ActiveSwap[] = Object.entries(substitutions).map(([originalCode, sub]) => ({
    originalCode,
    currentCode: sub.code,
    currentName: sub.name,
  }))

  // Real exercise names, keyed by code, straight from the owner's own
  // program — without this the model has no grounded source for a human-
  // readable name and has to guess one from the code alone (e.g. "SLC"
  // guessed as "Seated Leg Curl" when the program's real name is
  // "Single-Leg Calf Raise"). Falls back to the bare code for anything not
  // in the current program (e.g. a since-removed exercise still showing up
  // in older logged sessions).
  type RoutineProgram = Record<string, { ex?: Array<{ k: string; n?: string }> }>
  const program = (profile as { routine_config?: { program?: RoutineProgram } } | null)?.routine_config?.program || {}
  const exerciseNames: Record<string, string> = {}
  for (const session of Object.values(program)) {
    for (const ex of session.ex || []) {
      if (ex.n) exerciseNames[ex.k] = ex.n
    }
  }

  const sinceDate = args.sinceDate
  const exerciseCode = args.exerciseCode
  const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 30) : 12

  // `limit` caps session ROWS, not occurrences of `exerciseCode` — and a
  // single exercise only appears on one of the ~5-6 session codes in the
  // weekly rotation (e.g. Chest Supported Row is Pull-day only), so the
  // default 12 most-recent rows might contain just 2-3 real occurrences of
  // the exercise actually being asked about, not enough to see a genuine
  // trend. Widen the underlying fetch specifically for this case — the
  // returned `rows` stay small regardless (only matching-exercise rows
  // survive the per-session filter below), so this doesn't meaningfully
  // raise token cost, it just reaches back far enough in time to find
  // enough real data points for the exercise in question.
  const sessionFetchLimit = exerciseCode ? Math.min(limit * 6, 60) : limit

  let query = supabaseAdmin()
    .from('sessions')
    .select('d, s, ex, n')
    .eq('user_id', ownerUserId)
    .eq('type', 'PROGRAM')
    .order('d', { ascending: false })
    .limit(sessionFetchLimit)
  if (sinceDate) query = query.gte('d', sinceDate)

  const { data: sessionRows, error } = await query
  if (error) return { error: 'Could not read training data right now.' }

  const sessions = (sessionRows || []) as SheetSession[]

  const rows: TrainingDataRow[] = []
  for (const session of sessions) {
    let noteAttached = false
    for (const ex of session.ex || []) {
      if (exerciseCode && ex.k !== exerciseCode) continue
      // Notes are per-session, not per-exercise — attach once (on the
      // first row for that session) rather than repeating the same
      // string on every exercise row, which would just burn tokens.
      // Mirrors the old Apps Script's `idx === 0 ? body.n : ''` convention.
      const notes = !noteAttached && session.n ? session.n : undefined
      if (notes) noteAttached = true
      rows.push({
        date: session.d,
        session: session.s || '',
        exercise: ex.k,
        exerciseName: exerciseNames[ex.k] || ex.k,
        sets: formatSets(ex),
        topWeight: topWeightOf(ex),
        ...(notes ? { notes } : {}),
      })
    }
  }

  // The system prompt is deliberately static/cached (see
  // chatSystemPrompt.ts's header comment) so it can never carry today's
  // date — without it anywhere, the model had to infer "today" purely from
  // the most recent row it happened to see, fragile for "this week vs last
  // week" reasoning. get_training_data is always called before any
  // data-grounded claim (per the system prompt's DATA HONESTY rule) and
  // isn't cached, so this is where a reliable date anchor actually belongs.
  const today = new Date().toISOString().slice(0, 10)

  return activeSwaps.length ? { rows, today, activeSwaps } : { rows, today }
}

export interface ResolvedSwap {
  code: string
  name: string
}

// Resolves the Coach's plain-language replacement guess into a real
// exercise_type — the ~500-entry Strava catalog never enters the model's
// context; it just names what it wants and this runs server-side. Shared
// with the frontend's own swap picker via exerciseCatalog.ts, so a swap
// suggested by the Coach and one picked by hand resolve identically.
export function resolveExerciseSwap(currentCode: string, replacementQuery: string): ResolvedSwap | null {
  const match = resolveExerciseQuery(replacementQuery, currentCode)
  if (!match) return null
  return { code: match.type, name: match.label }
}

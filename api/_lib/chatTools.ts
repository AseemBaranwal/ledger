import { supabaseAdmin } from './supabaseAdmin.js'
import { resolveExerciseQuery } from './exerciseCatalog.js'
import type { ToolDefinition } from './anthropic.js'

// get_recovery_data's handler lives in recoveryData.ts (all the Google
// Health fetching/normalizing is there) but is re-exported here so the tool
// loop in api/chat/message.ts imports every tool handler from one place,
// same as the training-data and swap handlers below.
import type { RecoveryResult } from './recoveryData.js'
export { getRecoveryData } from './recoveryData.js'
export type { RecoveryResult, RecoveryDay, RecoveryBaselines } from './recoveryData.js'

// Coach-only trimming of getRecoveryData's result, applied at this call
// site rather than inside recoveryData.ts itself — that function is also
// the data source for the Trends tab's Recovery chart and the Sheet-sync
// export (api/google-health/recovery.ts, api/sheets/sync.ts), both of
// which need the full `days` array. The Coach almost never does: the
// system prompt already tells the model `days`/`baselines` are only for a
// specific historical date the person asks about, since `latest`/`deltas`/
// `flags`/`readiness` already cover every other case — so by default this
// drops `days` from what actually reaches the model's context, and only
// includes it when the model explicitly asks via `includeDailyBreakdown`.
export function toCoachRecoveryPayload(result: RecoveryResult, includeDailyBreakdown?: boolean): unknown {
  if (result.status !== 'ok' || includeDailyBreakdown) return result
  const { days: _days, ...withoutDays } = result
  return withoutDays
}

// Same pattern for get_body_weight_data — handler lives in
// bodyWeightData.ts.
export { getBodyWeightData } from './bodyWeightData.js'
export type { WeightResult, WeightDay } from './bodyWeightData.js'

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_training_data',
    description:
      "Reads the owner's logged training sessions. Always call this before answering any question about current weights, trends, or PRs — never answer from memory. Returns a compact list of recent sessions, each row carrying both the exercise code and its real exerciseName from the owner's own program — always use that exerciseName verbatim (e.g. for suggest_exercise_adjustment) rather than guessing a name from the code, since abbreviations like \"SLC\" or \"SU\" are genuinely ambiguous and guessing produces wrong names. Also returns the real current date as `today` (use this for any this-week/last-week reasoning — don't infer today's date from the most recent session row). Every exercise code here IS the owner's real, current exercise for that program slot — an accepted suggest_exercise_swap changes it directly, there's no separate 'active swap' state to reconcile, so a code you see here is always current, never a stale pre-swap identity. A set in the sets string may carry a trailing (e)/(o)/(h) for easy/ok/hard — a real effort tag the owner gave that specific set at the time; a set with no suffix simply wasn't tagged, not necessarily 'ok'. Use tagged effort directly when it's there instead of inferring difficulty from rep counts alone. A run of identical sets is collapsed to one entry with a trailing ' xN' (e.g. \"105x6(o) x4\" means four identical sets, not one) — this is pure compression, not fewer real sets than logged. A row may also carry notes — whatever the owner wrote down for that session (form, energy, anything worth remembering) — attached once per session on its first row, not repeated on every row. Ground observations in these notes directly rather than guessing at context the owner already told you. `trends` is `{exerciseCode: {sessionCode: {...}}}` — nested by session code, NOT flat by exercise alone, because the SAME exercise code can appear in two different program slots with genuinely different loading (e.g. a per-arm variant in one session vs. a different scheme in another) — blending those would produce a misleading combined trend. Look up the specific session's entry (matching a row's own `session` field) for the exercise you're evaluating. Each entry gives a precomputed `weightTrend` ('flat'/'rising'/'falling'/'mixed'/'n/a') and `recentEffort` ('clean'/'mixed'/'hard'/'n/a') from that exercise-in-that-session's last 2-3 occurrences, plus its current `lastWorkingWeight` (the mode weight of the most recent occurrence, not necessarily the session's single heaviest set) — use this as your primary signal for whether an exercise has room to progress rather than re-deriving the same comparison yourself from the raw `sets` strings across many rows. Only (exercise, session) pairs with 2+ occurrences in this window get an entry; fewer than that has nothing to compare yet (you can already see that directly from `rows`) so it's simply absent from `trends`, not included as an empty/n-a entry. It is a mechanical summary, not a final verdict: still weigh it together with any relevant `notes` (an equipment mixup, home vs. gym, an off day already explained) before proposing a change.",
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
      "Reads recovery/readiness data recorded by the owner's watch and returns it PRE-ANALYZED, not raw — use `flags`, `readiness`, and `deltas` as your primary signal; don't re-derive your own comparisons from `days`. Fields: `latest` (most recent day's resting heart rate, HRV in ms, sleep minutes, and `sleepQualityIndex`); `deltas` (latest vs baseline, already subtracted — `restingHeartRate` in bpm, `hrvPercent` in %, `sleepMinutes` in minutes, all signed); `flags` (short factual strings, already decided to be worth mentioning — includes GOOD signals too, e.g. an HRV rise, not just concerning ones); `readiness` (`'primed'`, `'normal'`, or `'compromised'`, computed from the deltas — state it plainly rather than re-judging the numbers yourself); `baselines` (the window medians `latest` is compared against). The full day-by-day `days` array is NOT included by default — `latest`/`deltas`/`flags`/`readiness`/`baselines` already cover every case except one: the person asking about a specific historical date (e.g. 'how'd I sleep last Tuesday'). Only then, pass `includeDailyBreakdown: true` to get it. `sleepQualityIndex` (0-100, on `latest` and each day) is LEDGER'S OWN estimate modeled on Fitbit's published sleep-score methodology (duration/efficiency/restoration) — it is NOT a number Fitbit or Google actually computed or reports (confirmed: no such field exists anywhere in the Google Health API). Call it 'an estimated sleep quality score,' never 'your Fitbit sleep score' or similar. It's `null` on nights without full sleep-stage data — say sleep quality wasn't available that night rather than guessing a number. Call this tool when the question is about readiness, fatigue, whether to push hard or back off today, or during a weekly check-in — not for questions purely about weights or logged sets. This data may legitimately be unavailable: `status` comes back as `not_connected` (the owner never linked their watch) or `needs_reconnect` (access expired — normal, it lapses about weekly by design). Both are ordinary states, NOT errors: when you get one, simply coach from training data alone and mention in a single short clause that recovery data isn't connected right now. Do not apologize at length, do not retry, and never treat it as something broken. A response may also carry `unavailable`, naming metrics that couldn't be read this time — say so plainly rather than treating a missing metric as a normal reading.",
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many days back to look. Defaults to 14 if omitted; heart-rate metrics are capped at 14 days by the upstream API regardless.',
        },
        includeDailyBreakdown: {
          type: 'boolean',
          description:
            'Set true only when you actually need the raw day-by-day list — e.g. the person asked about one specific date. Omitted or false by default: latest/deltas/flags/readiness/baselines already cover every other case and cost far fewer tokens.',
        },
      },
    },
  },
  {
    name: 'get_body_weight_data',
    description:
      "Reads body-weight readings (from a smart scale synced to Google Health, not a manual log) as `days` (each `{date, weightLb}`, already in lb) and `latest` (the most recent reading, or null if the window has none). Defaults to the last 6 days if `days` isn't given — a short window on purpose, since body weight fluctuates day to day (hydration, food timing, time of measurement) and this tool is meant for grounding a near-term nutrition/recomposition conversation, not for a long-range trend (the app's own Trends tab charts that separately). Don't compute a rate of change or call something a real trend off 2-3 points — say what the readings show plainly and let the person draw conclusions, or ask for a wider `days` window if a longer view is actually needed. Same two routine non-error states as get_recovery_data: `status` may be `not_connected` (never linked) or `needs_reconnect` (expired — normal, ~weekly) — mention it in one short clause and move on, don't apologize or treat it as broken.",
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many days back to look. Defaults to 6 if omitted.',
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

// The MODE (most-common) weight across a session's sets, not the max —
// used only by the trend computation below, never for the row's own
// `topWeight` field. A session's max set is often a single deliberately
// heavier top set (e.g. one 115 lb single among four 105 lb sets), which
// isn't the actual working weight that session was built around — mode
// reflects what was really trained, which is what a weight-trend signal
// needs to compare occurrence to occurrence. Ties break toward whichever
// weight was seen first (stable, deterministic).
export function modeWeightOf(ex: SheetExercise): number | null {
  const weights = ex.ws ? ex.ws.filter((w): w is number => typeof w === 'number') : typeof ex.w === 'number' ? [ex.w] : []
  if (!weights.length) return null
  const counts = new Map<number, number>()
  for (const w of weights) counts.set(w, (counts.get(w) || 0) + 1)
  let bestWeight = weights[0]
  let bestCount = 0
  for (const [w, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestWeight = w
    }
  }
  return bestWeight
}

export function formatSets(ex: SheetExercise): string {
  const tokens = ex.r.map((reps, i) => {
    const w = ex.ws ? ex.ws[i] : ex.w
    const base = typeof w === 'number' ? `${w}x${reps}` : `${reps}`
    // Only append a suffix for sets the owner actually tagged — most
    // sets (all historical ones, and any set today's owner skips
    // tagging) have no effort recorded, and leaving those bare keeps
    // the string from bloating with a marker that means nothing.
    const effort = ex.ef?.[i]
    return effort ? `${base}(${effort})` : base
  })

  // Collapse a run of consecutive identical set entries into one "…xN"
  // entry (e.g. four straight 105x6(o) sets → "105x6(o) x4") — pure
  // compression, no information lost, and it matters in practice: most
  // working sets within one exercise ARE identical, so the uncompressed
  // form repeated the same substring 3-4 times per exercise for zero
  // informational gain, across every exercise in every returned session.
  const runs: string[] = []
  let i = 0
  while (i < tokens.length) {
    let j = i
    while (j < tokens.length && tokens[j] === tokens[i]) j++
    const count = j - i
    runs.push(count > 1 ? `${tokens[i]} x${count}` : tokens[i])
    i = j
  }
  return runs.join(',')
}

export type WeightTrend = 'flat' | 'rising' | 'falling' | 'mixed' | 'n/a'
export type EffortCharacter = 'clean' | 'mixed' | 'hard' | 'n/a'

// One entry per (exercise code, session code) pair — see the `trends`
// field comment on the get_training_data tool for why it's nested by
// session rather than flat by exercise code alone.
export interface ExerciseTrendSummary {
  // How many of the last (up to 3) occurrences of this exercise IN THIS
  // SESSION this is based on. Always >= 2 — a pair with only 1 occurrence
  // gets no entry at all (see the loop below that builds this map), since
  // that fact is already fully visible from `rows` without a precomputed
  // field.
  occurrences: number
  // The working weight (mode, not max — see modeWeightOf) from the most
  // recent occurrence.
  lastWorkingWeight: number | null
  // Direction of the working weight across the sampled occurrences,
  // earliest to latest. 'n/a' only if some sampled occurrence has no
  // trackable weight (a bodyweight exercise) — occurrences is always >= 2
  // here, that's not itself a reason for 'n/a' anymore.
  weightTrend: WeightTrend
  // Effort character of the MOST RECENT occurrence only (fraction of its
  // sets tagged 'h'): 0% = 'clean', 100% = 'hard', anything between =
  // 'mixed'. 'n/a' if that occurrence has no sets at all.
  recentEffort: EffortCharacter
}

function classifyWeightTrend(weightsMostRecentFirst: number[]): WeightTrend {
  if (weightsMostRecentFirst.length < 2) return 'n/a'
  const chronological = [...weightsMostRecentFirst].reverse()
  if (chronological.every((w) => w === chronological[0])) return 'flat'
  const nonDecreasing = chronological.every((w, i) => i === 0 || w >= chronological[i - 1])
  const nonIncreasing = chronological.every((w, i) => i === 0 || w <= chronological[i - 1])
  if (nonDecreasing) return 'rising'
  if (nonIncreasing) return 'falling'
  return 'mixed'
}

function classifyEffort(hardCount: number, totalCount: number): EffortCharacter {
  if (totalCount === 0) return 'n/a'
  const ratio = hardCount / totalCount
  if (ratio === 0) return 'clean'
  if (ratio === 1) return 'hard'
  return 'mixed'
}

// Reads the owner's logged sessions directly from Supabase's `sessions`
// table (see supabase/sessions.sql) — the same table sessionStore.ts writes
// to client-side, just queried from the backend so tool results are
// grounded in real data rather than trusting anything the client sends.
//
// There is no separate "active swap" concept to reconcile here — a swap
// (suggest_exercise_swap, accepted) writes directly into the SAME program
// record this reads exerciseName from (see api/chat/apply-exercise-swap.ts
// and CLAUDE.md's exercise-code section), so the program is always already
// current. An earlier design routed swaps through a separate redirect
// table (profiles.exercise_substitutions) and surfaced it here as
// `activeSwaps` specifically so the model could tell whether an earlier
// swap suggestion had actually taken effect — that whole class of
// uncertainty doesn't exist anymore now that there's only one place a
// swap's result ever lives.
export async function getTrainingData(
  ownerUserId: string,
  args: { exerciseCode?: string; sinceDate?: string; limit?: number }
): Promise<
  | { rows: TrainingDataRow[]; today: string; trends?: Record<string, Record<string, ExerciseTrendSummary>> }
  | { error: string }
> {
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

  let sessionsQuery = supabaseAdmin()
    .from('sessions')
    .select('d, s, ex, n')
    .eq('user_id', ownerUserId)
    .eq('type', 'PROGRAM')
    .order('d', { ascending: false })
    .limit(sessionFetchLimit)
  if (sinceDate) sessionsQuery = sessionsQuery.gte('d', sinceDate)

  // The profile fetch (for program names) and the sessions fetch don't
  // depend on each other's results — running them concurrently instead of
  // two sequential awaits saves a full Supabase round-trip on this hot path
  // (get_training_data is called on essentially every Coach turn, per the
  // system prompt's DATA HONESTY rule).
  const [{ data: profile }, { data: sessionRows, error }] = await Promise.all([
    supabaseAdmin().from('profiles').select('routine_config').eq('id', ownerUserId).single(),
    sessionsQuery,
  ])

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

  if (error) return { error: 'Could not read training data right now.' }

  const sessions = (sessionRows || []) as SheetSession[]

  const rows: TrainingDataRow[] = []
  // Collected alongside `rows` in the same pass — `sessions` is already
  // ordered most-recent-first (the query's own `.order('d', {ascending:
  // false})`), so capping each (session, code) pair's list at 3 naturally
  // keeps exactly the last (up to) 3 occurrences the trend below is meant
  // to summarize, with no second pass or extra query needed.
  //
  // Keyed by (session code, exercise code), NOT exercise code alone —
  // confirmed against a real 4-week window that the same exercise code can
  // appear in two genuinely different program slots with different loading
  // (e.g. "SLC" is a per-arm single-leg calf raise in one session and a
  // completely different loading scheme in another — real data showed
  // ~195 lb there vs ~40 lb in the other). Blending those into one trend
  // produced a real, wrong "falling" signal that was actually just two
  // unrelated numbers from two different slots, not an actual regression.
  // The program config itself (`routine_config.program`) already keys
  // exercises per session slot this same way, so this mirrors the real
  // data model rather than assuming a code means one consistent thing.
  const trendOccurrences = new Map<string, Map<string, { modeWeight: number | null; hardCount: number; totalCount: number }[]>>()

  for (const session of sessions) {
    let noteAttached = false
    const sessionCode = session.s || ''
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
        session: sessionCode,
        exercise: ex.k,
        exerciseName: exerciseNames[ex.k] || ex.k,
        sets: formatSets(ex),
        topWeight: topWeightOf(ex),
        ...(notes ? { notes } : {}),
      })

      const bySession = trendOccurrences.get(ex.k) ?? new Map()
      const occurrences = bySession.get(sessionCode) ?? []
      if (occurrences.length < 3) {
        const hardCount = (ex.ef || []).filter((e) => e === 'h').length
        occurrences.push({ modeWeight: modeWeightOf(ex), hardCount, totalCount: ex.r.length })
        bySession.set(sessionCode, occurrences)
        trendOccurrences.set(ex.k, bySession)
      }
    }
  }

  // A precomputed signal, same philosophy as get_recovery_data's flags/
  // readiness (see recoveryData.ts's own comment on this) — the model
  // should reason from an already-summarized weightTrend/recentEffort
  // pair instead of re-deriving it itself by scanning every row's raw
  // `sets` string for each exercise, every single turn. Deliberately
  // stops short of a final "progress/hold" verdict, unlike recovery's
  // readiness: a training-weight call also depends on context this
  // function doesn't have (an equipment mixup noted in `notes`, home vs.
  // gym) that the model still needs to weigh itself.
  //
  // Skips any (session, code) pair with fewer than 2 occurrences entirely,
  // rather than including it as an 'n/a' entry — confirmed against a real
  // broad-window fetch that this matters: a plain "how's my training
  // going" call can span 20+ distinct exercise codes, and roughly half
  // typically have only one occurrence in the window. An 'n/a' entry for
  // those costs real tokens (a real trace showed this outweighing what
  // set-compression saved) while adding nothing the model can't already
  // see directly from `rows` — a single row for a code IS the fact that
  // it's too new to trend, no precomputed field needed to say so. A code
  // is omitted from `trends` entirely once every session slot it appears
  // in falls below that threshold.
  const trends: Record<string, Record<string, ExerciseTrendSummary>> = {}
  for (const [code, bySession] of trendOccurrences) {
    for (const [sessionCode, occurrences] of bySession) {
      if (occurrences.length < 2) continue
      const weights = occurrences.map((o) => o.modeWeight).filter((w): w is number => w != null)
      const latest = occurrences[0]
      trends[code] ??= {}
      trends[code][sessionCode] = {
        occurrences: occurrences.length,
        lastWorkingWeight: latest.modeWeight,
        weightTrend: weights.length === occurrences.length ? classifyWeightTrend(weights) : 'n/a',
        recentEffort: classifyEffort(latest.hardCount, latest.totalCount),
      }
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

  return {
    rows,
    today,
    ...(Object.keys(trends).length ? { trends } : {}),
  }
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

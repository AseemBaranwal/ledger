import { supabaseAdmin } from './supabaseAdmin.js'
import { resolveExerciseQuery } from './exerciseCatalog.js'
import type { ToolDefinition } from './anthropic.js'

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_training_data',
    description:
      "Reads the owner's logged training sessions from their connected Google Sheet. Always call this before answering any question about current weights, trends, or PRs — never answer from memory. Returns a compact list of recent sessions, optionally filtered.",
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
  sets: string
  topWeight: number | null
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
      return typeof w === 'number' ? `${w}x${reps}` : `${reps}`
    })
    .join(',')
}

// Reads the owner's sheet_url from their profile (service-role, server-side
// only) and pulls sessions directly from the Sheet — the same GET the client
// makes via restoreFromSheet, just called from the backend so tool results
// are grounded in real data rather than trusting anything the client sends.
export async function getTrainingData(
  ownerUserId: string,
  args: { exerciseCode?: string; sinceDate?: string; limit?: number }
): Promise<{ rows: TrainingDataRow[] } | { error: string }> {
  const { data: profile, error } = await supabaseAdmin()
    .from('profiles')
    .select('sheet_url')
    .eq('id', ownerUserId)
    .single()

  if (error || !profile || !(profile as { sheet_url?: string }).sheet_url) {
    return { error: 'No Sheet connected for this account yet.' }
  }

  const sheetUrl = (profile as { sheet_url: string }).sheet_url

  let data: { sessions?: SheetSession[] }
  try {
    const res = await fetch(`${sheetUrl}?action=export`)
    data = await res.json()
  } catch {
    return { error: 'Could not reach the Google Sheet right now.' }
  }

  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const sinceDate = args.sinceDate
  const exerciseCode = args.exerciseCode
  const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 30) : 12

  const filtered = sessions
    .filter((s) => (sinceDate ? s.d >= sinceDate : true))
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, limit)

  const rows: TrainingDataRow[] = []
  for (const session of filtered) {
    for (const ex of session.ex || []) {
      if (exerciseCode && ex.k !== exerciseCode) continue
      rows.push({
        date: session.d,
        session: session.s || '',
        exercise: ex.k,
        sets: formatSets(ex),
        topWeight: topWeightOf(ex),
      })
    }
  }

  return { rows }
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

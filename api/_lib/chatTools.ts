import { supabaseAdmin } from './supabaseAdmin.js'
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
    name: 'suggest_weight_change',
    description:
      'Proposes a new target weight for one exercise. This does NOT change anything by itself — it only records a suggestion that the owner will review and accept themselves in the app. Never claim the weight has actually been changed.',
    input_schema: {
      type: 'object',
      properties: {
        exerciseCode: { type: 'string', description: 'The exercise code, e.g. "SQ".' },
        exerciseName: { type: 'string', description: 'The human-readable exercise name, e.g. "Back Squat".' },
        currentWeight: { type: 'number', description: 'The current weight in lb, from the training data.' },
        suggestedWeight: { type: 'number', description: 'The proposed new weight in lb.' },
        reasoning: { type: 'string', description: 'One or two sentences on why this change makes sense right now.' },
      },
      required: ['exerciseCode', 'exerciseName', 'currentWeight', 'suggestedWeight', 'reasoning'],
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

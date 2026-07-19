// Frontend-specific additions on top of the shared, provider-agnostic
// catalog logic in api/_lib/exerciseCatalog.ts (re-exported below) — the
// same module the Coach chat's exercise tools use server-side, so "resolved
// the same way in both cases" is structural, not just a convention.
//
// Cross-importing from api/_lib is an established pattern in this codebase
// (see CLAUDE.md's testing-convention notes) — Vite and vitest both resolve
// the internal .js-suffixed imports fine even though api/ sits outside src/.
export * from '../../api/_lib/exerciseCatalog.js'
import { STRAVA_EXERCISE_TYPES } from '../../api/_lib/stravaExerciseCatalog.js'
import { prettifyExerciseType, groupForType, type MuscleGroup } from '../../api/_lib/exerciseCatalog.js'
import type { Program, ProgramExercise } from '@/types'

const GROUP_TO_COLOUR_KEY: Record<MuscleGroup, string> = {
  Legs: 'legs',
  Push: 'push',
  Pull: 'pull',
  Sprint: 'sprint',
  Other: '',
}

const DEFAULT_COLOUR = '#FFB020'

export function toProgramExercise(type: string, overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return {
    k: type,
    n: prettifyExerciseType(type),
    s: 3,
    r: 10,
    w: 0,
    u: 'lb',
    group: groupForType(type),
    cue: '',
    ...overrides,
  }
}

export interface CustomExerciseEntry {
  n: string
  group: MuscleGroup
  u: string
}

export interface ExerciseDisplay {
  name: string
  group: MuscleGroup
  colour: string
}

// The single source of truth for "what do I show for this exercise code" —
// used by TrendsTab and HistoryTab so a swapped-in or custom exercise looks
// exactly as polished as a programmed one, instead of falling back to a raw
// code. Checked in order: the live program config (existing exercises),
// then Strava's catalog (anything picked via the swap/add picker — name and
// group are fully derived, no storage needed), then the local custom
// registry (free-text entries with no Strava match), then a raw fallback.
export function resolveExerciseDisplay(
  code: string,
  program: Program,
  colours: Record<string, string>,
  customExercises: Record<string, CustomExerciseEntry> = {}
): ExerciseDisplay {
  for (const p of Object.values(program)) {
    const e = p.ex.find((x) => x.k === code)
    if (e) return { name: e.n.replace(' ★', ''), group: e.group, colour: colours[p.colour] || DEFAULT_COLOUR }
  }

  if (STRAVA_EXERCISE_TYPES.has(code)) {
    const group = groupForType(code)
    return { name: prettifyExerciseType(code), group, colour: colours[GROUP_TO_COLOUR_KEY[group]] || DEFAULT_COLOUR }
  }

  const custom = customExercises[code]
  if (custom) return { name: custom.n, group: custom.group, colour: colours[GROUP_TO_COLOUR_KEY[custom.group]] || DEFAULT_COLOUR }

  return { name: code, group: 'Other', colour: DEFAULT_COLOUR }
}

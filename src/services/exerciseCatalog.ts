// Turns Strava's existing exercise_type vocabulary (api/_lib/stravaExerciseCatalog.ts)
// into a browsable/searchable picker for swapping or adding exercises mid-session,
// and resolves a display name/muscle-group/colour for ANY exercise code — whether
// it's one of Ledger's own short program codes (SQ, BSS, ...), a Strava exercise_type
// picked from the catalog (STANDING_CALF_RAISE, ...), or a fully custom one-off.
//
// Cross-importing from api/_lib is an established pattern in this codebase (see
// CLAUDE.md's testing-convention notes) — Vite and vitest both resolve the internal
// .js-suffixed relative imports fine even though api/ sits outside src/.
import { STRAVA_EXERCISE_CATALOG, STRAVA_EXERCISE_TYPES } from '../../api/_lib/stravaExerciseCatalog.js'
import { stravaExerciseTypeForCode } from '../../api/_lib/stravaMapping.js'
import type { Program, ProgramExercise } from '@/types'

export type MuscleGroup = 'Legs' | 'Push' | 'Pull' | 'Sprint' | 'Other'

// Maps each of Strava's 31 movement-pattern keys onto Ledger's own 4-bucket
// taxonomy (confirmed against config.json: this app groups by which day/split
// an exercise is trained on, not strict anatomy — e.g. ab work like Hanging Leg
// Raise and Cable Crunches is tagged "Legs" because it's programmed on lower-body
// days). Inevitably approximate for movement patterns that mix push/pull variants
// (e.g. "Flye" contains both chest flyes and rear-delt flyes) — picking the
// majority-intent bucket rather than one-off per exercise_type, to keep this a
// maintainable ~31-entry table instead of a ~508-entry one.
const MOVEMENT_PATTERN_GROUP: Record<string, MuscleGroup> = {
  'Bench Press': 'Push',
  'Calf Raise': 'Legs',
  Cardio: 'Sprint',
  Carry: 'Pull',
  Chop: 'Pull',
  Core: 'Legs',
  Curl: 'Pull',
  Deadlift: 'Legs',
  Flye: 'Push',
  'Hip Raise': 'Legs',
  'Hip Stability': 'Legs',
  'Hip Swing': 'Legs',
  Hyperextension: 'Legs',
  'Lateral Raise': 'Push',
  'Leg Curl': 'Legs',
  'Leg Raise': 'Legs',
  Lunge: 'Legs',
  'Olympic Lift': 'Legs',
  Plank: 'Legs',
  Plyo: 'Legs',
  'Pull Up': 'Pull',
  'Push Up': 'Push',
  Row: 'Pull',
  'Shoulder Press': 'Push',
  'Shoulder Stability': 'Push',
  Shrug: 'Pull',
  'Sit Up': 'Legs',
  Squat: 'Legs',
  'Total Body': 'Other',
  'Triceps Extension': 'Push',
  'Warm Up': 'Other',
}

const GROUP_TO_COLOUR_KEY: Record<MuscleGroup, string> = {
  Legs: 'legs',
  Push: 'push',
  Pull: 'pull',
  Sprint: 'sprint',
  Other: '',
}

const DEFAULT_COLOUR = '#FFB020'

// type -> movement pattern, built once rather than re-scanning all 31 keys
// on every lookup.
const TYPE_TO_PATTERN = new Map<string, string>()
for (const [pattern, types] of Object.entries(STRAVA_EXERCISE_CATALOG)) {
  for (const t of types) TYPE_TO_PATTERN.set(t, pattern)
}

// Flat, prettified catalog built once for fast repeated searching as the
// user types.
interface CatalogEntry { type: string; label: string; group: MuscleGroup }
const FLAT_CATALOG: CatalogEntry[] = Object.entries(STRAVA_EXERCISE_CATALOG).flatMap(([pattern, types]) =>
  types.map((type) => ({ type, label: prettifyExerciseType(type), group: MOVEMENT_PATTERN_GROUP[pattern] || 'Other' }))
)

export function prettifyExerciseType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function movementPatternForType(type: string): string | null {
  return TYPE_TO_PATTERN.get(type) ?? null
}

export function groupForType(type: string): MuscleGroup {
  const pattern = movementPatternForType(type)
  return (pattern && MOVEMENT_PATTERN_GROUP[pattern]) || 'Other'
}

// Same-movement-pattern siblings for a given Strava exercise_type — the
// "compatible alternates" list (e.g. Standing Calf Raise -> Seated Calf
// Raise, Machine Calf Press, ...), excluding the type itself.
export function alternatesForType(type: string): CatalogEntry[] {
  const pattern = movementPatternForType(type)
  if (!pattern) return []
  return (STRAVA_EXERCISE_CATALOG[pattern] || [])
    .filter((t) => t !== type)
    .map((t) => ({ type: t, label: prettifyExerciseType(t), group: MOVEMENT_PATTERN_GROUP[pattern] || 'Other' }))
}

// Alternates for one of Ledger's own program codes (e.g. "SCR"), resolved
// via its Strava mapping first.
export function alternatesForCode(code: string): CatalogEntry[] {
  const type = stravaExerciseTypeForCode(code)
  if (type === 'CORE_GENERIC') return [] // unmapped code — no known movement pattern to draw alternates from
  return alternatesForType(type)
}

export function searchCatalog(query: string, limit = 40): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const starts: CatalogEntry[] = []
  const includes: CatalogEntry[] = []
  for (const entry of FLAT_CATALOG) {
    const label = entry.label.toLowerCase()
    if (label.startsWith(q)) starts.push(entry)
    else if (label.includes(q)) includes.push(entry)
    if (starts.length >= limit) break
  }
  return [...starts, ...includes].slice(0, limit)
}

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

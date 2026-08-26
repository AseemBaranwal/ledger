// Pure exercise-catalog derivation logic — shared by the frontend swap/add
// picker (src/services/exerciseCatalog.ts re-exports everything here) and
// the Coach chat's exercise tools (chatTools.ts). Kept dependency-free (no
// @/types, no React) so both sides can import it without pulling anything
// they don't need.
import { STRAVA_EXERCISE_CATALOG } from './stravaExerciseCatalog.js'
import { stravaExerciseTypeForCode } from './stravaMapping.js'

export type MuscleGroup = 'Legs' | 'Push' | 'Pull' | 'Sprint' | 'Other'

export type Equipment =
  | 'Barbell' | 'Dumbbell' | 'Machine' | 'Cable' | 'Kettlebell' | 'Box'
  | 'Band' | 'Plate' | 'Rings' | 'MedicineBall' | 'StabilityBall' | 'Bodyweight'

export interface CatalogEntry {
  type: string
  label: string
  group: MuscleGroup
}

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

// type -> movement pattern, built once rather than re-scanning all 31 keys
// on every lookup.
const TYPE_TO_PATTERN = new Map<string, string>()
for (const [pattern, types] of Object.entries(STRAVA_EXERCISE_CATALOG)) {
  for (const t of types) TYPE_TO_PATTERN.set(t, pattern)
}

export function prettifyExerciseType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// Flat, prettified catalog built once for fast repeated searching.
const FLAT_CATALOG: CatalogEntry[] = Object.entries(STRAVA_EXERCISE_CATALOG).flatMap(([pattern, types]) =>
  types.map((type) => ({ type, label: prettifyExerciseType(type), group: MOVEMENT_PATTERN_GROUP[pattern] || 'Other' }))
)

export function movementPatternForType(type: string): string | null {
  return TYPE_TO_PATTERN.get(type) ?? null
}

export function groupForType(type: string): MuscleGroup {
  const pattern = movementPatternForType(type)
  return (pattern && MOVEMENT_PATTERN_GROUP[pattern]) || 'Other'
}

// Equipment, derived from the exercise_type string itself — no new data to
// maintain, since Strava's own naming already bakes equipment into most
// codes (e.g. BARBELL_BACK_SQUAT, CABLE_CRUNCH). Token-matched (split on
// `_`, exact membership) rather than substring-matched — a naive substring
// check on "RING" or "STABILITY" false-positives on HAMSTRING and the
// unrelated HIP_STABILITY_GENERIC/SHOULDER_STABILITY_GENERIC movement-
// pattern categories.
//
// The 12-category list and priority order were chosen by running this
// classifier against all ~508 codes and checking real coverage, not
// guessed — categories below 4 matches were folded into a neighbor rather
// than kept as their own barely-used bucket. Order matters: checked
// top-to-bottom, first match wins (e.g. SMITH_MACHINE_BENCH_PRESS matches
// Machine before it could match anything else).
const EQUIPMENT_TOKENS: [Equipment, string[]][] = [
  ['Kettlebell', ['KETTLEBELL']],
  ['Cable', ['CABLE']],
  ['Machine', ['MACHINE', 'SMITH', 'SLED']],
  ['Barbell', ['BARBELL', 'EZ', 'TRAP']],
  ['Dumbbell', ['DUMBBELL']],
  ['Band', ['BANDED', 'BAND']],
  ['MedicineBall', ['MEDICINE']],
  ['Rings', ['SUSPENSION', 'RING', 'TRX']],
  ['StabilityBall', ['SWISSBALL', 'BOSU']],
  ['Plate', ['PLATE']],
  ['Box', ['BOX']],
]

// Anything matching none of the above defaults to Bodyweight — correctly
// so, since that's the real majority case (push-ups, planks, lunges,
// sprints, stretches — ~60% of the catalog needs no equipment at all).
export function equipmentForType(type: string): Equipment {
  const tokens = new Set(type.split('_'))
  for (const [equipment, keywords] of EQUIPMENT_TOKENS) {
    if (keywords.some((kw) => tokens.has(kw))) return equipment
  }
  return 'Bodyweight'
}

// Equipment for one of Ledger's own program codes (e.g. "SQ") or a custom
// exercise slug — resolves to a Strava type first (same as
// alternatesForCode), so the picker can show an icon regardless of which
// of the picker's several row sources a given exercise came from.
export function equipmentForCode(code: string): Equipment {
  const type = stravaExerciseTypeForCode(code) ?? 'CORE_GENERIC'
  return equipmentForType(type)
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
  if (!type) return [] // genuinely unmapped code — no known movement pattern to draw alternates from
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

// Best-effort resolution of a plain-language description (e.g. "leg press")
// into a real Strava exercise_type — used by the Coach chat's swap tool so
// the model never needs the ~500-entry catalog in its context, just a
// free-text guess that gets resolved server-side. Alternates for the
// current exercise are checked first (muscle-group-consistent, higher
// quality match), falling through to a general catalog search.
export function resolveExerciseQuery(query: string, currentCode?: string): CatalogEntry | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  if (currentCode) {
    const alternates = alternatesForCode(currentCode)
    const exact = alternates.find((a) => a.label.toLowerCase() === q)
    if (exact) return exact
    // Substring match only, in either direction — no single-word matching,
    // since a query like "bench press" would otherwise match "Machine Calf
    // Press" purely on the shared word "press", producing a completely
    // wrong-muscle-group suggestion.
    const substring = alternates.find((a) => a.label.toLowerCase().includes(q) || q.includes(a.label.toLowerCase()))
    if (substring) return substring
  }

  const results = searchCatalog(query, 3)
  return results.length ? results[0] : null
}

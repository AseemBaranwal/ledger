import { describe, it, expect } from 'vitest'
import {
  prettifyExerciseType,
  movementPatternForType,
  groupForType,
  alternatesForType,
  alternatesForCode,
  searchCatalog,
  toProgramExercise,
  resolveExerciseDisplay,
} from '@/services/exerciseCatalog'
import type { Program } from '@/types'

describe('prettifyExerciseType', () => {
  it('turns a Strava exercise_type constant into a readable label', () => {
    expect(prettifyExerciseType('STANDING_CALF_RAISE')).toBe('Standing Calf Raise')
    expect(prettifyExerciseType('LEG_PRESS')).toBe('Leg Press')
  })
})

describe('movementPatternForType', () => {
  it('finds the movement-pattern key containing a given exercise_type', () => {
    expect(movementPatternForType('STANDING_CALF_RAISE')).toBe('Calf Raise')
    expect(movementPatternForType('MACHINE_LEG_PRESS')).toBe('Squat')
  })

  it('returns null for an unknown type', () => {
    expect(movementPatternForType('NOT_A_REAL_TYPE')).toBeNull()
  })
})

describe('groupForType', () => {
  it('maps known movement patterns onto the 4-bucket taxonomy', () => {
    expect(groupForType('STANDING_CALF_RAISE')).toBe('Legs')
    expect(groupForType('BARBELL_BENCH_PRESS')).toBe('Push')
    expect(groupForType('SEATED_CABLE_ROW')).toBe('Pull')
  })

  it('falls back to Other for an unknown type', () => {
    expect(groupForType('NOT_A_REAL_TYPE')).toBe('Other')
  })
})

describe('alternatesForType', () => {
  it('returns sibling exercise_types from the same movement pattern, excluding itself', () => {
    const alts = alternatesForType('STANDING_CALF_RAISE')
    expect(alts.length).toBeGreaterThan(0)
    expect(alts.some((a) => a.type === 'STANDING_CALF_RAISE')).toBe(false)
    expect(alts.some((a) => a.type === 'SEATED_CALF_RAISE')).toBe(true)
  })

  it('returns an empty list for an unknown type', () => {
    expect(alternatesForType('NOT_A_REAL_TYPE')).toEqual([])
  })
})

describe('alternatesForCode', () => {
  it('resolves a Ledger program code to its Strava type first, then finds alternates', () => {
    const alts = alternatesForCode('SCR') // Standing Calf Raise
    expect(alts.some((a) => a.type === 'SEATED_CALF_RAISE')).toBe(true)
  })

  it('returns an empty list for a code with no Strava mapping', () => {
    expect(alternatesForCode('NOT_A_REAL_CODE')).toEqual([])
  })
})

describe('searchCatalog', () => {
  it('ranks prefix matches before substring matches', () => {
    const results = searchCatalog('squat')
    expect(results.length).toBeGreaterThan(0)
    const firstNonPrefix = results.findIndex((r) => !r.label.toLowerCase().startsWith('squat'))
    const lastPrefix = results.map((r) => r.label.toLowerCase().startsWith('squat')).lastIndexOf(true)
    if (firstNonPrefix !== -1) expect(lastPrefix).toBeLessThan(firstNonPrefix)
  })

  it('is case-insensitive', () => {
    expect(searchCatalog('LEG PRESS').length).toBe(searchCatalog('leg press').length)
  })

  it('returns nothing for an empty query', () => {
    expect(searchCatalog('')).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchCatalog('a', 5).length).toBeLessThanOrEqual(5)
  })
})

describe('toProgramExercise', () => {
  it('builds a full ProgramExercise with sensible defaults', () => {
    const def = toProgramExercise('LEG_PRESS')
    expect(def.k).toBe('LEG_PRESS')
    expect(def.n).toBe('Leg Press')
    expect(def.group).toBe('Legs')
    expect(def.s).toBeGreaterThan(0)
  })

  it('merges overrides on top of the defaults', () => {
    const def = toProgramExercise('LEG_PRESS', { w: 200 })
    expect(def.w).toBe(200)
  })
})

describe('resolveExerciseDisplay', () => {
  const program: Program = {
    LA: {
      name: 'Lower A', full: 'Lower A', colour: 'legs', gym: 'X', day: 1,
      ex: [{ k: 'SQ', n: 'Back Squat', s: 4, r: 6, w: 75, u: 'lb', group: 'Legs', cue: '' }],
    },
  }
  const colours = { legs: '#00C2A8', push: '#4C9BE8', pull: '#B57CF6', sprint: '#FF6B4A' }

  it('prefers the live program config when the code is still programmed', () => {
    const d = resolveExerciseDisplay('SQ', program, colours)
    expect(d).toEqual({ name: 'Back Squat', group: 'Legs', colour: '#00C2A8' })
  })

  it('derives name/group/colour from the Strava catalog for a swapped-in code', () => {
    const d = resolveExerciseDisplay('LEG_PRESS', program, colours)
    expect(d.name).toBe('Leg Press')
    expect(d.group).toBe('Legs')
    expect(d.colour).toBe('#00C2A8')
  })

  it('falls back to the custom registry for a free-text entry', () => {
    const d = resolveExerciseDisplay('CUSTOM_SLED_DRAG', program, colours, {
      CUSTOM_SLED_DRAG: { n: 'Sled Drag', group: 'Sprint', u: 'lb' },
    })
    expect(d).toEqual({ name: 'Sled Drag', group: 'Sprint', colour: '#FF6B4A' })
  })

  it('falls back to the raw code when nothing resolves it', () => {
    const d = resolveExerciseDisplay('MYSTERY', program, colours)
    expect(d.name).toBe('MYSTERY')
    expect(d.group).toBe('Other')
  })
})

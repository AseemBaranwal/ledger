import { describe, it, expect } from 'vitest'
import { topWeightOf, formatSets, TOOLS, resolveExerciseSwap } from '../../api/_lib/chatTools'

describe('topWeightOf', () => {
  it('returns the highest per-set weight when tracked per set', () => {
    expect(topWeightOf({ k: 'SQ', r: [5, 5, 5], ws: [95, 100, 97.5] })).toBe(100)
  })

  it('falls back to the single legacy weight field when no per-set weights exist', () => {
    expect(topWeightOf({ k: 'SQ', r: [5], w: 80 })).toBe(80)
  })

  it('returns null for a bodyweight exercise with no weight tracked at all', () => {
    expect(topWeightOf({ k: 'HLR', r: [10, 12] })).toBeNull()
  })

  it('ignores non-numeric entries in a per-set weight array', () => {
    expect(topWeightOf({ k: 'SQ', r: [5, 5], ws: [100, null as unknown as number] })).toBe(100)
  })
})

describe('formatSets', () => {
  it('formats weight×reps pairs comma-separated', () => {
    expect(formatSets({ k: 'SQ', r: [5, 6], ws: [100, 100] })).toBe('100x5,100x6')
  })

  it('formats bodyweight sets as just the rep count', () => {
    expect(formatSets({ k: 'HLR', r: [10, 12] })).toBe('10,12')
  })
})

describe('TOOLS', () => {
  it('defines exactly the three tools the coach can call', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['get_training_data', 'suggest_exercise_adjustment', 'suggest_exercise_swap'])
  })

  it('requires exerciseCode/exerciseName/reasoning on suggest_exercise_adjustment, but not the optional change fields', () => {
    const tool = TOOLS.find((t) => t.name === 'suggest_exercise_adjustment')!
    const schema = tool.input_schema as { required: string[]; properties: Record<string, unknown> }
    expect(schema.required.sort()).toEqual(['exerciseCode', 'exerciseName', 'reasoning'])
    // the weight/reps/sets pairs are all optional — a proposal can change just one
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['currentWeight', 'suggestedWeight', 'currentReps', 'suggestedReps', 'currentSets', 'suggestedSets'])
    )
  })

  it('marks all suggest_exercise_swap fields as required so the model cannot half-fill a proposal', () => {
    const tool = TOOLS.find((t) => t.name === 'suggest_exercise_swap')!
    const schema = tool.input_schema as { required: string[]; properties: Record<string, unknown> }
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort())
  })
})

describe('resolveExerciseSwap', () => {
  it('resolves a plain-language replacement into a real exercise_type + label', () => {
    const result = resolveExerciseSwap('SQ', 'leg press')
    expect(result).toEqual({ code: 'LEG_PRESS', name: 'Leg Press' })
  })

  it('returns null when nothing matches', () => {
    expect(resolveExerciseSwap('SQ', 'zzz_not_a_real_exercise_zzz')).toBeNull()
  })
})

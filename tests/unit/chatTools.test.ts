import { describe, it, expect, vi } from 'vitest'
import { topWeightOf, formatSets, TOOLS, resolveExerciseSwap, getTrainingData } from '../../api/_lib/chatTools'
import { supabaseAdmin } from '../../api/_lib/supabaseAdmin'

vi.mock('../../api/_lib/supabaseAdmin', () => ({ supabaseAdmin: vi.fn() }))

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

describe('getTrainingData', () => {
  // supabase-js query builders are "thenable" at every step in the chain
  // (select/eq/gte/order/limit all return something awaitable), not just
  // at the end — this mock chain resolves to {data, error} no matter where
  // the real code stops chaining, matching that behavior.
  function makeSessionsChain(data: unknown[], error: unknown = null) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data, error }),
    }
    return chain
  }

  function mockSupabase(profileData: unknown, sessionRows: unknown[], sessionError: unknown = null) {
    vi.mocked(supabaseAdmin).mockReturnValue({
      from: (table: string) => {
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profileData, error: null }) }) }) }
        }
        return makeSessionsChain(sessionRows, sessionError)
      },
    } as any)
  }

  // Caught live: without visibility into whether an earlier swap actually
  // took effect, the model would sometimes hedge in prose instead of
  // calling suggest_exercise_swap again. activeSwaps gives it the real
  // current state instead of making it guess from conversation history.
  it('includes activeSwaps when the profile has standing substitutions', async () => {
    mockSupabase({ exercise_substitutions: { SQ: { code: 'BARBELL_BACK_SQUAT', name: 'Barbell Back Squat' } } }, [])

    const result = await getTrainingData('user-1', {})

    expect(result).toMatchObject({
      activeSwaps: [{ originalCode: 'SQ', currentCode: 'BARBELL_BACK_SQUAT', currentName: 'Barbell Back Squat' }],
    })
  })

  it('omits activeSwaps entirely when there are none, rather than sending an empty array', async () => {
    mockSupabase({ exercise_substitutions: {} }, [])

    const result = await getTrainingData('user-1', {})

    expect(result).not.toHaveProperty('activeSwaps')
  })

  it('shapes rows from the sessions table, one per logged exercise', async () => {
    mockSupabase({ exercise_substitutions: {} }, [
      { d: '2026-07-14', s: 'LA', ex: [{ k: 'SQ', r: [5, 5], ws: [80, 80] }] },
    ])

    const result = await getTrainingData('user-1', {})

    expect(result).toMatchObject({
      rows: [{ date: '2026-07-14', session: 'LA', exercise: 'SQ', sets: '80x5,80x5', topWeight: 80 }],
    })
  })

  it('filters rows to the requested exerciseCode', async () => {
    mockSupabase({ exercise_substitutions: {} }, [
      { d: '2026-07-14', s: 'LA', ex: [{ k: 'SQ', r: [5], ws: [80] }, { k: 'BSS', r: [8], ws: [20] }] },
    ])

    const result = await getTrainingData('user-1', { exerciseCode: 'SQ' })

    expect(result).toMatchObject({ rows: [{ exercise: 'SQ' }] })
    expect((result as { rows: unknown[] }).rows).toHaveLength(1)
  })

  it('surfaces a clean error when the sessions query fails, rather than throwing', async () => {
    mockSupabase({ exercise_substitutions: {} }, [], { message: 'connection refused' })

    const result = await getTrainingData('user-1', {})

    expect(result).toEqual({ error: 'Could not read training data right now.' })
  })
})

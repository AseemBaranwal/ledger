import { describe, it, expect, vi } from 'vitest'
import {
  topWeightOf,
  modeWeightOf,
  formatSets,
  TOOLS,
  resolveExerciseSwap,
  getTrainingData,
  toCoachRecoveryPayload,
} from '../../api/_lib/chatTools'
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

  it('appends an effort suffix only to sets that were actually tagged', () => {
    expect(formatSets({ k: 'SQ', r: [5, 5, 5], ws: [100, 100, 100], ef: ['h', null, 'e'] })).toBe('100x5(h),100x5,100x5(e)')
  })

  // Regression test for the token-efficiency pass: a run of identical sets
  // now collapses to one '…xN' entry rather than repeating the same
  // substring — pure compression, same information, fewer tokens.
  it("collapses a run of identical sets into one '…xN' entry", () => {
    expect(formatSets({ k: 'SQ', r: [5, 5], ws: [100, 100] })).toBe('100x5 x2')
  })

  it('only collapses the actually-identical run, keeping varied sets separate', () => {
    expect(formatSets({ k: 'SQ', r: [7, 6, 6, 5], ws: [105, 105, 105, 115] })).toBe('105x7,105x6 x2,115x5')
  })

  it('does not collapse sets that differ only by effort tag', () => {
    expect(formatSets({ k: 'SQ', r: [5, 5], ws: [100, 100], ef: ['h', 'o'] })).toBe('100x5(h),100x5(o)')
  })
})

describe('modeWeightOf', () => {
  it('returns the most common per-set weight, not the max', () => {
    // One heavier single (115) among three sets at the real working
    // weight (105) — the working weight is what a trend should compare,
    // not an occasional top single.
    expect(modeWeightOf({ k: 'SQ', r: [7, 6, 6, 5], ws: [105, 105, 105, 115] })).toBe(105)
  })

  it('falls back to the single legacy weight field when no per-set weights exist', () => {
    expect(modeWeightOf({ k: 'SQ', r: [5], w: 80 })).toBe(80)
  })

  it('returns null for a bodyweight exercise with no weight tracked at all', () => {
    expect(modeWeightOf({ k: 'HLR', r: [10, 12] })).toBeNull()
  })
})

describe('TOOLS', () => {
  it('defines exactly the five tools the coach can call', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'get_training_data',
      'get_recovery_data',
      'get_body_weight_data',
      'suggest_exercise_adjustment',
      'suggest_exercise_swap',
    ])
  })

  // TOOLS must stay a static array with no per-request content: Anthropic
  // renders tools → system → messages, so the single cache_control marker on
  // the last system block covers the tool schemas too (see CLAUDE.md).
  it('exposes get_recovery_data with an all-optional schema so the model can call it bare', () => {
    const tool = TOOLS.find((t) => t.name === 'get_recovery_data')!
    const schema = tool.input_schema as { required?: string[]; properties: Record<string, unknown> }
    expect(Object.keys(schema.properties)).toEqual(['days', 'includeDailyBreakdown'])
    expect(schema.required).toBeUndefined()
  })

  // Unavailability is the expected steady state here — Google force-expires
  // refresh tokens weekly while the OAuth app is in Testing status — so the
  // description has to tell the model that in the tool itself, not rely on
  // the system prompt alone.
  it('tells the model that missing recovery data is normal, not an error', () => {
    const tool = TOOLS.find((t) => t.name === 'get_recovery_data')!
    expect(tool.description).toContain('not_connected')
    expect(tool.description).toContain('needs_reconnect')
    expect(tool.description.toLowerCase()).toContain('normal')
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

  // The system prompt is deliberately static/cached so it can never carry
  // today's date — without this, the model had to infer "today" from the
  // most recent session row, fragile for this-week/last-week reasoning.
  it('includes today as a real ISO date, not derived from the session rows', async () => {
    mockSupabase({ exercise_substitutions: {} }, [{ d: '2020-01-01', s: 'LA', ex: [] }])

    const result = await getTrainingData('user-1', {})

    expect(result).toHaveProperty('today')
    const today = (result as { today: string }).today
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today).not.toBe('2020-01-01') // must reflect the real date, not a row's date
  })

  it('shapes rows from the sessions table, one per logged exercise', async () => {
    mockSupabase({ exercise_substitutions: {} }, [
      { d: '2026-07-14', s: 'LA', ex: [{ k: 'SQ', r: [5, 5], ws: [80, 80] }] },
    ])

    const result = await getTrainingData('user-1', {})

    expect(result).toMatchObject({
      rows: [{ date: '2026-07-14', session: 'LA', exercise: 'SQ', sets: '80x5 x2', topWeight: 80 }], // identical sets collapse
    })
  })

  // Caught live: the model guessed "SLC" was "Seated Leg Curl" when it's
  // actually "Single-Leg Calf Raise" in the real program — get_training_data
  // never gave it a real name to work from, only the bare code, so it had
  // to guess from an inherently ambiguous abbreviation. Resolving the name
  // from the owner's own routine_config.program removes the guesswork.
  it("resolves each row's exerciseName from the owner's program config, not the code", async () => {
    mockSupabase(
      { exercise_substitutions: {}, routine_config: { program: { LB: { ex: [{ k: 'SLC', n: 'Single-Leg Calf Raise' }] } } } },
      [{ d: '2026-07-25', s: 'LB', ex: [{ k: 'SLC', r: [15], ws: [175] }] }]
    )

    const result = await getTrainingData('user-1', {})

    expect(result).toMatchObject({ rows: [{ exercise: 'SLC', exerciseName: 'Single-Leg Calf Raise' }] })
  })

  it('falls back to the bare code for an exercise no longer in the current program', async () => {
    mockSupabase({ exercise_substitutions: {}, routine_config: { program: {} } }, [
      { d: '2026-07-14', s: 'LA', ex: [{ k: 'OLD_CODE', r: [10] }] },
    ])

    const result = await getTrainingData('user-1', {})

    expect(result).toMatchObject({ rows: [{ exercise: 'OLD_CODE', exerciseName: 'OLD_CODE' }] })
  })

  it("attaches a session's notes to only its first exercise row, not every row", async () => {
    mockSupabase({ exercise_substitutions: {} }, [
      { d: '2026-07-14', s: 'LA', n: 'Felt strong today', ex: [{ k: 'SQ', r: [5], ws: [80] }, { k: 'BSS', r: [8], ws: [20] }] },
    ])

    const result = await getTrainingData('user-1', {})

    expect(result).toMatchObject({ rows: [{ exercise: 'SQ', notes: 'Felt strong today' }, { exercise: 'BSS' }] })
    expect((result as { rows: Array<{ notes?: string }> }).rows[1]).not.toHaveProperty('notes')
  })

  it('omits notes entirely when the session has none', async () => {
    mockSupabase({ exercise_substitutions: {} }, [
      { d: '2026-07-14', s: 'LA', ex: [{ k: 'SQ', r: [5], ws: [80] }] },
    ])

    const result = await getTrainingData('user-1', {})

    expect((result as { rows: Array<{ notes?: string }> }).rows[0]).not.toHaveProperty('notes')
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

  // A single exercise only appears on ~1 of the ~5-6 session codes in the
  // weekly rotation (e.g. a Pull-day-only exercise), so capping the
  // underlying fetch at the same `limit` used for general "recent sessions"
  // questions starved exercise-specific trend questions down to 2-3 real
  // data points. Widening the fetch specifically when exerciseCode is set
  // (without changing what a plain "how's my training going" call fetches)
  // fixes that without the model needing to know this quirk exists.
  it('widens the underlying session fetch when filtering to one exerciseCode', async () => {
    const limitSpy = vi.fn(function (this: any) {
      return this
    })
    vi.mocked(supabaseAdmin).mockReturnValue({
      from: (table: string) => {
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { exercise_substitutions: {} }, error: null }) }) }) }
        }
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          gte: () => chain,
          order: () => chain,
          limit: limitSpy.mockImplementation(() => chain),
          then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
        }
        return chain
      },
    } as any)

    await getTrainingData('user-1', { exerciseCode: 'CSR' })
    expect(limitSpy).toHaveBeenCalledWith(60) // default limit (12) * 6 = 72, capped at 60

    limitSpy.mockClear()
    await getTrainingData('user-1', {})
    expect(limitSpy).toHaveBeenCalledWith(12) // unfiltered calls are unaffected
  })

  describe('trends', () => {
    // Mock rows must already be most-recent-first, matching the real
    // query's own `.order('d', {ascending:false})` — getTrainingData
    // assumes that ordering rather than re-sorting.

    it('flags flat weight + clean effort as a ready-to-progress signal', async () => {
      mockSupabase({ exercise_substitutions: {} }, [
        { d: '2026-08-24', s: 'LA', ex: [{ k: 'SQ', r: [6, 6, 6, 6], ws: [105, 105, 105, 105] }] },
        { d: '2026-08-17', s: 'LA', ex: [{ k: 'SQ', r: [6, 6, 6], ws: [105, 105, 105], ef: [null, null, 'h'] }] },
        { d: '2026-08-10', s: 'LA', ex: [{ k: 'SQ', r: [7, 6, 6, 5], ws: [105, 105, 105, 115] }] },
      ])

      const result = await getTrainingData('user-1', {})

      expect(result).toMatchObject({
        trends: { SQ: { occurrences: 3, lastWorkingWeight: 105, weightTrend: 'flat', recentEffort: 'clean' } },
      })
    })

    it('flags flat weight + all-hard effort as a stuck plateau', async () => {
      mockSupabase({ exercise_substitutions: {} }, [
        { d: '2026-08-25', s: 'PU', ex: [{ k: 'DBL', r: [13, 13, 13, 13], ws: [15, 15, 15, 15], ef: ['h', 'h', 'h', 'h'] }] },
        { d: '2026-08-19', s: 'PU', ex: [{ k: 'DBL', r: [15, 15], ws: [15, 15] }] },
      ])

      const result = await getTrainingData('user-1', {})

      expect(result).toMatchObject({
        trends: { DBL: { occurrences: 2, lastWorkingWeight: 15, weightTrend: 'flat', recentEffort: 'hard' } },
      })
    })

    it('marks a single occurrence as too-new (n/a) rather than guessing a trend', async () => {
      mockSupabase({ exercise_substitutions: {} }, [
        { d: '2026-08-24', s: 'LA', ex: [{ k: 'MACHINE_HIP_ABDUCTION', r: [15, 15], ws: [50, 50] }] },
      ])

      const result = await getTrainingData('user-1', {})

      expect(result).toMatchObject({ trends: { MACHINE_HIP_ABDUCTION: { occurrences: 1, weightTrend: 'n/a' } } })
    })

    it('flags rising working weight across occurrences', async () => {
      mockSupabase({ exercise_substitutions: {} }, [
        { d: '2026-08-24', s: 'LA', ex: [{ k: 'RDL', r: [8], ws: [100] }] },
        { d: '2026-08-17', s: 'LA', ex: [{ k: 'RDL', r: [8], ws: [95] }] },
      ])

      const result = await getTrainingData('user-1', {})

      expect(result).toMatchObject({ trends: { RDL: { weightTrend: 'rising' } } })
    })

    it("uses the MODE weight, not the max, so one heavier single doesn't skew the trend", async () => {
      // Real-world case: three sets at 105, one heavier single at 115 —
      // the working weight is 105, not 115.
      mockSupabase({ exercise_substitutions: {} }, [
        { d: '2026-08-10', s: 'LA', ex: [{ k: 'SQ', r: [7, 6, 6, 5], ws: [105, 105, 105, 115] }] },
      ])

      const result = await getTrainingData('user-1', {})

      expect(result).toMatchObject({ trends: { SQ: { lastWorkingWeight: 105 } } })
    })

    it('caps trend occurrences at the most recent 3, even with a wider fetch window', async () => {
      mockSupabase({ exercise_substitutions: {} }, [
        { d: '2026-08-24', s: 'PL', ex: [{ k: 'WPU', r: [5], w: 5 }] },
        { d: '2026-08-20', s: 'PL', ex: [{ k: 'WPU', r: [5], w: 0 }] },
        { d: '2026-08-13', s: 'PL', ex: [{ k: 'WPU', r: [5], w: 0 }] },
        { d: '2026-08-06', s: 'PL', ex: [{ k: 'WPU', r: [5], w: 0 }] },
      ])

      const result = await getTrainingData('user-1', {})

      expect(result).toMatchObject({ trends: { WPU: { occurrences: 3 } } })
    })

    it('omits trends entirely when there are no rows at all', async () => {
      mockSupabase({ exercise_substitutions: {} }, [])

      const result = await getTrainingData('user-1', {})

      expect(result).not.toHaveProperty('trends')
    })
  })
})

describe('toCoachRecoveryPayload', () => {
  const okResult = {
    status: 'ok' as const,
    days: [{ date: '2026-08-25', restingHeartRate: 69, hrvMs: null, sleepMinutes: null, sleepQualityIndex: null }],
    baselines: { restingHeartRate: 66, hrvMs: 67.2, sleepMinutes: 376, sleepQualityIndex: 85 },
    latest: { date: '2026-08-25', restingHeartRate: 69, hrvMs: null, sleepMinutes: null, sleepQualityIndex: null },
    deltas: { restingHeartRate: 3, hrvPercent: null, sleepMinutes: null },
    flags: [],
    readiness: 'normal' as const,
  }

  it('strips the raw `days` array by default', () => {
    const payload = toCoachRecoveryPayload(okResult)
    expect(payload).not.toHaveProperty('days')
    expect(payload).toMatchObject({ status: 'ok', readiness: 'normal' })
  })

  it('keeps `days` when includeDailyBreakdown is true', () => {
    const payload = toCoachRecoveryPayload(okResult, true)
    expect(payload).toHaveProperty('days', okResult.days)
  })

  it('passes non-ok statuses through unchanged (nothing to strip)', () => {
    const notConnected = { status: 'not_connected' as const }
    expect(toCoachRecoveryPayload(notConnected)).toEqual(notConnected)
  })
})

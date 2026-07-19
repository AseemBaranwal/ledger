import { describe, it, expect } from 'vitest'
import {
  sportTypeForCode,
  supportsStructuredSets,
  stravaExerciseTypeForCode,
  buildStravaSets,
  estimateElapsedSeconds,
  resolveTiming,
  buildActivityDescription,
} from '../../api/_lib/stravaMapping'

describe('sportTypeForCode', () => {
  it('maps known weight-training codes to WeightTraining', () => {
    expect(sportTypeForCode('LA')).toBe('WeightTraining')
    expect(sportTypeForCode('PU')).toBe('WeightTraining')
    expect(sportTypeForCode('PL')).toBe('WeightTraining')
    expect(sportTypeForCode('LB')).toBe('WeightTraining')
  })

  it('maps the sprint code to Run', () => {
    expect(sportTypeForCode('SP')).toBe('Run')
  })

  it('falls back to Workout for an unknown code', () => {
    expect(sportTypeForCode('NOT_A_REAL_CODE')).toBe('Workout')
  })
})

describe('supportsStructuredSets', () => {
  it('is true for the sport types Strava accepts JSON-sets uploads for', () => {
    expect(supportsStructuredSets('WeightTraining')).toBe(true)
    expect(supportsStructuredSets('HighIntensityIntervalTraining')).toBe(true)
    expect(supportsStructuredSets('Workout')).toBe(true)
    expect(supportsStructuredSets('Crossfit')).toBe(true)
  })

  it('is false for sport types outside that set', () => {
    expect(supportsStructuredSets('Run')).toBe(false)
    expect(supportsStructuredSets('Ride')).toBe(false)
  })
})

describe('stravaExerciseTypeForCode', () => {
  it('maps a known Ledger code to its Strava exercise_type', () => {
    expect(stravaExerciseTypeForCode('SQ')).toBe('BARBELL_BACK_SQUAT')
    expect(stravaExerciseTypeForCode('HLR')).toBe('HANGING_LEG_RAISE')
  })

  it('falls back to CORE_GENERIC for an unmapped code rather than throwing', () => {
    expect(stravaExerciseTypeForCode('NOT_A_REAL_CODE')).toBe('CORE_GENERIC')
  })

  it('passes through a code that is already a valid Strava exercise_type unchanged', () => {
    // This is exactly what the exercise-swap picker produces when a user
    // picks something straight from Strava's catalog — it needs zero
    // entries in the hand-maintained map to upload correctly.
    expect(stravaExerciseTypeForCode('LEG_PRESS')).toBe('LEG_PRESS')
    expect(stravaExerciseTypeForCode('SEATED_CALF_RAISE')).toBe('SEATED_CALF_RAISE')
  })
})

describe('buildStravaSets', () => {
  it('flattens per-exercise reps/weights into one set per rep, converting lb to kg', () => {
    const sets = buildStravaSets([{ k: 'SQ', r: [5, 5], ws: [100, 100] }])
    expect(sets).toHaveLength(2)
    expect(sets[0].exercise_type).toBe('BARBELL_BACK_SQUAT')
    expect(sets[0].repetitions).toBe(5)
    // 100 lb -> ~45.36 kg
    expect(sets[0].weight).toBeCloseTo(45.36, 1)
  })

  it('omits weight entirely for bodyweight sets rather than sending 0', () => {
    const sets = buildStravaSets([{ k: 'HLR', r: [10, 12], w: null }])
    expect(sets).toHaveLength(2)
    expect(sets[0].weight).toBeUndefined()
  })

  it('preserves set order across multiple exercises', () => {
    const sets = buildStravaSets([
      { k: 'SQ', r: [5], ws: [100] },
      { k: 'BSS', r: [8], ws: [40] },
    ])
    expect(sets.map((s) => s.exercise_type)).toEqual(['BARBELL_BACK_SQUAT', 'DUMBBELL_BULGARIAN_SPLIT_SQUATS'])
  })
})

describe('estimateElapsedSeconds', () => {
  it('estimates ~150s per set, above the clamp floor', () => {
    const seconds = estimateElapsedSeconds([{ k: 'SQ', r: new Array(10).fill(1) }]) // 10 sets
    expect(seconds).toBe(10 * 150)
  })

  it('clamps a tiny session up to the 20-minute floor', () => {
    const seconds = estimateElapsedSeconds([{ k: 'SQ', r: [1] }]) // 1 set = 150s
    expect(seconds).toBe(20 * 60)
  })

  it('clamps a huge session down to the 2-hour ceiling', () => {
    const seconds = estimateElapsedSeconds([{ k: 'SQ', r: new Array(200).fill(1) }])
    expect(seconds).toBe(120 * 60)
  })
})

describe('resolveTiming', () => {
  it('uses the real recorded start/end time when the range is plausible', () => {
    const result = resolveTiming('2026-07-14', [{ k: 'SQ', r: [1] }], '2026-07-14T10:00:00.000Z', '2026-07-14T11:00:00.000Z')
    expect(result.startTimeIso).toBe('2026-07-14T10:00:00.000Z')
    expect(result.elapsedSeconds).toBe(3600)
  })

  it('falls back to the noon placeholder + estimate when no timing is recorded', () => {
    const result = resolveTiming('2026-07-14', [{ k: 'SQ', r: new Array(10).fill(1) }])
    expect(result.startTimeIso).toBe('2026-07-14T12:00:00Z')
    expect(result.elapsedSeconds).toBe(10 * 150)
  })

  it('falls back when the recorded range is implausible (end before start)', () => {
    const result = resolveTiming('2026-07-14', [{ k: 'SQ', r: [1] }], '2026-07-14T11:00:00.000Z', '2026-07-14T10:00:00.000Z')
    expect(result.startTimeIso).toBe('2026-07-14T12:00:00Z')
  })

  it('falls back when the recorded range is implausibly short (clock skew)', () => {
    const result = resolveTiming('2026-07-14', [{ k: 'SQ', r: [1] }], '2026-07-14T10:00:00.000Z', '2026-07-14T10:00:05.000Z')
    expect(result.startTimeIso).toBe('2026-07-14T12:00:00Z')
  })

  it('falls back when the recorded range is implausibly long (draft left open)', () => {
    const result = resolveTiming('2026-07-14', [{ k: 'SQ', r: [1] }], '2026-07-14T10:00:00.000Z', '2026-07-16T10:00:00.000Z')
    expect(result.startTimeIso).toBe('2026-07-14T12:00:00Z')
  })
})

describe('buildActivityDescription', () => {
  it('formats each exercise as name: weight×reps, comma-separated', () => {
    const desc = buildActivityDescription([{ k: 'SQ', n: 'Back Squat', r: [5, 6], ws: [100, 100] }], undefined)
    expect(desc).toBe('Back Squat: 100×5, 100×6')
  })

  it('falls back to the code when no name is provided', () => {
    const desc = buildActivityDescription([{ k: 'SQ', r: [5], ws: [100] }], undefined)
    expect(desc).toBe('SQ: 100×5')
  })

  it('omits weight for bodyweight sets, shown as just the rep count', () => {
    const desc = buildActivityDescription([{ k: 'HLR', n: 'Hanging Leg Raise', r: [10, 12], w: null }], undefined)
    expect(desc).toBe('Hanging Leg Raise: 10, 12')
  })

  it('appends notes as a trailing blank-line-separated block', () => {
    const desc = buildActivityDescription([{ k: 'SQ', n: 'Back Squat', r: [5], ws: [100] }], 'Felt strong today')
    expect(desc).toBe('Back Squat: 100×5\n\nFelt strong today')
  })
})

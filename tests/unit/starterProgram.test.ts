import { describe, it, expect } from 'vitest'
import { STARTER_PROGRAM } from '@/data/starterProgram'
import { STRAVA_EXERCISE_TYPES } from '../../api/_lib/stravaExerciseCatalog'

describe('STARTER_PROGRAM', () => {
  it('has at least one program session with exercises', () => {
    const sessions = Object.values(STARTER_PROGRAM.program)
    expect(sessions.length).toBeGreaterThan(0)
    sessions.forEach((s) => expect(s.ex.length).toBeGreaterThan(0))
  })

  it('every exercise code is a real Strava exercise_type, so Strava posting resolves it with no extra mapping', () => {
    const codes = Object.values(STARTER_PROGRAM.program).flatMap((s) => s.ex.map((e) => e.k))
    codes.forEach((code) => expect(STRAVA_EXERCISE_TYPES.has(code)).toBe(true))
  })

  it('every exercise has a positive sets/reps target and a non-empty cue', () => {
    const allEx = Object.values(STARTER_PROGRAM.program).flatMap((s) => s.ex)
    allEx.forEach((e) => {
      expect(e.s).toBeGreaterThan(0)
      expect(e.r).toBeGreaterThan(0)
      expect(e.cue.length).toBeGreaterThan(0)
    })
  })

  it('every session has a colour key present in the colours map', () => {
    Object.values(STARTER_PROGRAM.program).forEach((s) => {
      expect(STARTER_PROGRAM.colours).toHaveProperty(s.colour)
    })
  })

  it('has no personal cues or gym names carried over from the owner\'s own program', () => {
    const text = JSON.stringify(STARTER_PROGRAM).toLowerCase()
    expect(text).not.toContain('rsl2')
  })
})

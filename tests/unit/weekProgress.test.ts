import { describe, it, expect } from 'vitest'
import { doneThisWeek, owedThisWeek, tgtStr } from '@/services/weekProgress'
import type { Session, Program, ProgramExercise } from '@/types'

// A Tuesday, so mondayOf resolves to the previous day.
const TODAY = new Date('2026-07-21T12:00:00')

describe('doneThisWeek', () => {
  it('collects session codes logged within the current Mon-Sun window', () => {
    const sessions: Session[] = [
      { d: '2026-07-20', s: 'LA' }, // Monday this week
      { d: '2026-07-14', s: 'PU' }, // Monday last week — excluded
    ]
    expect(doneThisWeek(sessions, TODAY)).toEqual(new Set(['LA']))
  })

  it('ignores sessions with no session code (e.g. body-scan-only entries)', () => {
    const sessions: Session[] = [{ d: '2026-07-20' }]
    expect(doneThisWeek(sessions, TODAY)).toEqual(new Set())
  })

  it('returns an empty set with no session history', () => {
    expect(doneThisWeek([], TODAY)).toEqual(new Set())
  })
})

describe('owedThisWeek', () => {
  const program: Program = {
    LA: { name: 'Lower A', full: '', colour: 'legs', gym: '', day: 1, ex: [] },
    PU: { name: 'Push', full: '', colour: 'push', gym: '', day: 2, ex: [] },
    PL: { name: 'Pull', full: '', colour: 'pull', gym: '', day: 4, ex: [] },
  }
  const weekDays = [1, 2, 3, 4, 5, 6, 0]
  const priority = ['LA', 'PU', 'PL']

  it('excludes anything already done, and anything scheduled after today', () => {
    // TODAY is Tuesday (dow 2) — PL is scheduled Thursday (dow 4), not owed yet.
    const done = new Set(['LA'])
    expect(owedThisWeek(program, priority, weekDays, 2, done)).toEqual(['PU'])
  })

  it('returns everything owed when nothing is done yet', () => {
    expect(owedThisWeek(program, priority, weekDays, 2, new Set())).toEqual(['LA', 'PU'])
  })

  it('returns nothing once everything scheduled so far is done', () => {
    expect(owedThisWeek(program, priority, weekDays, 2, new Set(['LA', 'PU']))).toEqual([])
  })
})

describe('tgtStr', () => {
  it('formats sets x reps with a positive starting weight', () => {
    const e: ProgramExercise = { k: 'SQ', n: 'Back Squat', s: 4, r: 6, w: 75, u: 'lb', group: 'Legs', cue: '' }
    expect(tgtStr(e)).toBe('4×6 · 75 lb')
  })

  it('omits the weight clause entirely when w is 0 (bodyweight)', () => {
    const e: ProgramExercise = { k: 'PU', n: 'Pull-up', s: 3, r: 8, w: 0, u: 'reps', group: 'Pull', cue: '' }
    expect(tgtStr(e)).toBe('3×8')
  })

  it('marks an assisted/added-weight unit with a leading +', () => {
    const e: ProgramExercise = { k: 'WPU', n: 'Weighted Pull-up', s: 4, r: 5, w: 10, u: '+lb', group: 'Pull', cue: '' }
    expect(tgtStr(e)).toBe('4×5 · +10 lb')
  })
})

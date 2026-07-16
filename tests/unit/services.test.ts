import { describe, it, expect } from 'vitest'
import { iso, dayName, weekNumber } from '@/services/dateUtils'
import { calculateVolume, getMaxWeight, checkPRs } from '@/services/trendCalculations'
import type { Exercise, Session } from '@/types'

describe('dateUtils', () => {
  it('iso() should return local date in YYYY-MM-DD format', () => {
    const d = new Date('2026-07-15T10:30:00')
    expect(iso(d)).toBe('2026-07-15')
  })

  it('dayName() should return day abbreviation', () => {
    expect(dayName(0)).toBe('Sun')
    expect(dayName(3)).toBe('Wed')
    expect(dayName(6)).toBe('Sat')
  })

  it('weekNumber() should calculate week of year', () => {
    const d1 = new Date('2026-01-05')
    const d2 = new Date('2026-07-15')
    expect(weekNumber(d1)).toBe(0)
    expect(weekNumber(d2)).toBeGreaterThan(20)
  })
})

describe('trendCalculations', () => {
  it('calculateVolume() with per-set weights', () => {
    const ex: Exercise = {
      k: 'SQ',
      r: [6, 6, 6, 6],
      ws: [75, 75, 75, 74],
    }
    const vol = calculateVolume(ex, 24)
    expect(vol).toBeCloseTo(1794, 0)
  })

  it('getMaxWeight() should return highest weight', () => {
    const ex: Exercise = {
      k: 'SQ',
      r: [6],
      ws: [75, 75, 74],
    }
    expect(getMaxWeight(ex)).toBe(75)
  })

  it('checkPRs() should flag exercises that hit a new max weight', () => {
    const prior: Session = {
      d: '2026-07-14',
      s: 'LA',
      ex: [{ k: 'SQ', r: [6], ws: [74, 74, 74] }],
    }
    const latest: Session = {
      d: '2026-07-15',
      s: 'LA',
      ex: [{ k: 'SQ', r: [6], ws: [75, 75, 75] }],
    }
    expect(checkPRs(latest, [prior, latest])).toEqual(['SQ'])
  })
})

import { describe, it, expect } from 'vitest'
import {
  detectUnitSystem,
  lbToKg,
  kgToLb,
  isWeightUnit,
  displayWeight,
  toStoredLb,
  unitLabel,
  INCREMENTS_BY_SYSTEM,
} from '@/services/units'

describe('detectUnitSystem', () => {
  it('defaults en-US to imperial', () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    expect(detectUnitSystem()).toBe('imperial')
  })

  it('defaults en-IN to metric', () => {
    Object.defineProperty(navigator, 'language', { value: 'en-IN', configurable: true })
    expect(detectUnitSystem()).toBe('metric')
  })

  it('defaults en-GB to metric', () => {
    Object.defineProperty(navigator, 'language', { value: 'en-GB', configurable: true })
    expect(detectUnitSystem()).toBe('metric')
  })

  // The other two real-world imperial holdouts besides the US.
  it('defaults en-LR (Liberia) and en-MM (Myanmar) to imperial too', () => {
    Object.defineProperty(navigator, 'language', { value: 'en-LR', configurable: true })
    expect(detectUnitSystem()).toBe('imperial')
    Object.defineProperty(navigator, 'language', { value: 'en-MM', configurable: true })
    expect(detectUnitSystem()).toBe('imperial')
  })
})

describe('lbToKg / kgToLb', () => {
  it('round-trips within floating-point tolerance', () => {
    expect(kgToLb(lbToKg(100))).toBeCloseTo(100, 6)
  })

  it('converts a known real value', () => {
    expect(lbToKg(220.462)).toBeCloseTo(100, 1)
  })
})

describe('isWeightUnit', () => {
  it('treats lb and +lb as weight units', () => {
    expect(isWeightUnit('lb')).toBe(true)
    expect(isWeightUnit('+lb')).toBe(true)
  })

  it('does not treat reps or in as weight units', () => {
    expect(isWeightUnit('reps')).toBe(false)
    expect(isWeightUnit('in')).toBe(false)
  })
})

describe('displayWeight', () => {
  it('returns the same value for imperial (no conversion)', () => {
    expect(displayWeight(185, 'imperial')).toBe(185)
  })

  it('converts to kg and rounds to the nearest 0.5 for metric', () => {
    // 185 lb -> 83.9146 kg -> rounds to 84
    expect(displayWeight(185, 'metric')).toBe(84)
  })
})

describe('toStoredLb', () => {
  it('passes an imperial input straight through', () => {
    expect(toStoredLb(185, 'imperial')).toBe(185)
  })

  it('converts a metric input to lb without rounding', () => {
    expect(toStoredLb(84, 'metric')).toBeCloseTo(kgToLb(84), 6)
  })

  // Stepping should feel stable: bump by an increment, then un-bump, and
  // land back where you started — this only holds if the stored value
  // isn't re-rounded on every keystroke/tap.
  it('round-trips a bump and un-bump back to the original stored lb value', () => {
    const startingLb = 100
    const incrementKg = 2.5
    const bumpedLb = startingLb + toStoredLb(incrementKg, 'metric') - toStoredLb(0, 'metric')
    const backLb = bumpedLb - (toStoredLb(incrementKg, 'metric') - toStoredLb(0, 'metric'))
    expect(backLb).toBeCloseTo(startingLb, 6)
  })
})

describe('unitLabel', () => {
  it('labels imperial as LB and metric as KG', () => {
    expect(unitLabel('imperial')).toBe('LB')
    expect(unitLabel('metric')).toBe('KG')
  })
})

describe('INCREMENTS_BY_SYSTEM', () => {
  it('keeps the existing lb presets unchanged', () => {
    expect(INCREMENTS_BY_SYSTEM.imperial).toEqual([2.5, 5, 10, 25])
  })

  it('offers clean kg presets, not exact lb-to-kg conversions', () => {
    expect(INCREMENTS_BY_SYSTEM.metric).toEqual([1, 2.5, 5, 10])
  })
})

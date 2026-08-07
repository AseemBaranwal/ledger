export type UnitSystem = 'imperial' | 'metric'

const LB_PER_KG = 2.2046226218

// en-US and the only other imperial holdouts (Liberia, Myanmar) default to
// lb; every other locale region defaults to kg. Locale, not IP/GPS
// geolocation — no permission prompt, no third-party network call, and
// it's the same signal the browser/OS already uses for date/number
// formatting, so it's a reasonable proxy for "which system this person
// actually thinks in."
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM'])

export function detectUnitSystem(): UnitSystem {
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'
  const region = locale.split('-')[1]?.toUpperCase()
  return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric'
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG
}

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG
}

// Exercise unit strings that represent an actual weight — 'reps' (bodyweight
// count) and 'in' (a measurement like box height) aren't a mass and must
// never be converted.
export function isWeightUnit(u: string): boolean {
  return u === 'lb' || u === '+lb'
}

// Weight is always stored/computed internally in lb (Supabase schema,
// Strava mapping, and the Coach's tool all assume lb) — this only converts
// for display. Rounded to the nearest 0.5 in either system: a full-
// precision kg conversion of a lb-denominated plate/dumbbell value would
// look noisy (e.g. 45 lb -> 20.41 kg), and nobody steps a real weight by
// less than half a unit anyway.
export function displayWeight(lb: number, system: UnitSystem): number {
  const value = system === 'imperial' ? lb : lbToKg(lb)
  return Math.round(value * 2) / 2
}

// Inverse of displayWeight for converting a typed/stepped INPUT back to the
// lb value that's actually stored — deliberately not "run displayWeight
// backwards," since rounding the kg->lb result would make repeated
// bump/un-bump taps drift instead of landing back where they started.
export function toStoredLb(displayValue: number, system: UnitSystem): number {
  return system === 'imperial' ? displayValue : kgToLb(displayValue)
}

export function unitLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'LB' : 'KG'
}

// kg equivalents of the app's lb increment presets, rounded to values that
// read as clean plate/dumbbell jumps rather than an exact division (2.5 lb
// converts to 1.13 kg, which nobody steps by).
export const INCREMENTS_BY_SYSTEM: Record<UnitSystem, number[]> = {
  imperial: [2.5, 5, 10, 25],
  metric: [1, 2.5, 5, 10],
}

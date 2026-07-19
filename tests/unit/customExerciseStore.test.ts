import { describe, it, expect, beforeEach } from 'vitest'
import { useCustomExerciseStore } from '@/store/customExerciseStore'

describe('customExerciseStore', () => {
  beforeEach(() => {
    useCustomExerciseStore.setState({ customExercises: {} })
  })

  it('registers a new custom exercise and returns a full ProgramExercise', () => {
    const def = useCustomExerciseStore.getState().registerCustom('Leg Press Machine', 'Legs')
    expect(def.n).toBe('Leg Press Machine')
    expect(def.group).toBe('Legs')
    expect(Object.keys(useCustomExerciseStore.getState().customExercises)).toHaveLength(1)
  })

  it('reuses an existing entry for a case-insensitive rematch, instead of creating a duplicate', () => {
    const first = useCustomExerciseStore.getState().registerCustom('Leg Press Machine', 'Legs')
    const second = useCustomExerciseStore.getState().registerCustom('leg press machine', 'Legs')
    expect(second.k).toBe(first.k)
    expect(Object.keys(useCustomExerciseStore.getState().customExercises)).toHaveLength(1)
  })

  it('reuses an existing entry when only whitespace differs', () => {
    const first = useCustomExerciseStore.getState().registerCustom('Sled  Drag', 'Sprint')
    const second = useCustomExerciseStore.getState().registerCustom('  Sled Drag  ', 'Sprint')
    expect(second.k).toBe(first.k)
    expect(Object.keys(useCustomExerciseStore.getState().customExercises)).toHaveLength(1)
  })

  it('creates distinct entries for genuinely different names', () => {
    useCustomExerciseStore.getState().registerCustom('Sled Drag', 'Sprint')
    useCustomExerciseStore.getState().registerCustom('Sled Push', 'Sprint')
    expect(Object.keys(useCustomExerciseStore.getState().customExercises)).toHaveLength(2)
  })

  it('defaults the unit to lb', () => {
    const def = useCustomExerciseStore.getState().registerCustom('Farmer Carry', 'Pull')
    expect(def.u).toBe('lb')
  })
})

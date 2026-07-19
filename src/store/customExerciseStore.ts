import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { scopedStorage } from '@/services/userScope'
import { toProgramExercise, type CustomExerciseEntry, type MuscleGroup } from '@/services/exerciseCatalog'
import type { ProgramExercise } from '@/types'

interface CustomExerciseStore {
  customExercises: Record<string, CustomExerciseEntry>
  // Registers a free-text exercise name, reusing an existing entry if one
  // already matches (case/whitespace-insensitive) rather than creating a
  // near-duplicate — this is what keeps "Leg Press" and "leg press " from
  // silently fragmenting into two different trend lines later.
  registerCustom: (name: string, group: MuscleGroup, unit?: string) => ProgramExercise
}

function normalize(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function slugify(name: string): string {
  return 'CUSTOM_' + normalize(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export const useCustomExerciseStore = create<CustomExerciseStore>()(
  persist(
    (set, get) => ({
      customExercises: {},

      registerCustom: (rawName, group, unit = 'lb') => {
        const name = normalize(rawName)
        const existingKey = Object.keys(get().customExercises).find(
          (k) => get().customExercises[k].n.toLowerCase() === name.toLowerCase()
        )
        if (existingKey) {
          const entry = get().customExercises[existingKey]
          return toProgramExercise(existingKey, { n: entry.n, group: entry.group, u: entry.u })
        }

        const key = slugify(name)
        set((state) => ({
          customExercises: { ...state.customExercises, [key]: { n: name, group, u: unit } },
        }))
        return toProgramExercise(key, { n: name, group, u: unit })
      },
    }),
    {
      name: 'ledger.customExercises',
      storage: createJSONStorage(() => scopedStorage),
    }
  )
)

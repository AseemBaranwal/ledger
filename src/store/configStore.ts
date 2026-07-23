import { create } from 'zustand'
import { supabase } from '@/services/supabaseClient'
import { STARTER_PROGRAM } from '@/data/starterProgram'
import type { Program, RestDays, Config } from '@/types'
import { fetchExerciseSubstitutions, type ExerciseSubstitution } from '@/services/chat'

interface ConfigStore {
  program: Program
  restDays: RestDays
  colours: Record<string, string>
  schedule: { weekDays: number[]; priority: string[]; restColour: Record<string, string> }
  loading: boolean
  error: string | null
  // Standing exercise substitutions accepted from the Coach (original code
  // -> replacement), applied at session-start time — see TodayTab.tsx's
  // handleStart. Owner-only feature, so this is always empty for anyone
  // else; fetching it is harmless either way (the endpoint 403s cleanly).
  substitutions: Record<string, ExerciseSubstitution>

  // Reads the signed-in user's own program from profiles.routine_config.
  // A brand-new user has none yet (null) — seeded from STARTER_PROGRAM so
  // they're immediately usable, no manual setup required. Replaces the old
  // "static config.json + Sheet weight overlay" two-step: the program and
  // its current weight/reps/sets targets now live in one place.
  loadOrSeedProgram: (userId: string, routineConfig: unknown | null) => Promise<void>
  loadSubstitutions: () => Promise<void>
  // Optimistic local update so a swap accepted this session is reflected
  // immediately, without waiting for a re-fetch.
  setSubstitution: (originalCode: string, replacement: ExerciseSubstitution) => void
  // Back to a neutral, unpersonalized state — called on sign-out or when
  // switching to a different signed-in user, so the previous person's
  // program can't flash on screen while the new one's profile is loading.
  resetProgram: () => void
}

function isConfig(value: unknown): value is Config {
  return Boolean(value && typeof value === 'object' && 'program' in (value as object))
}

export const useConfigStore = create<ConfigStore>((set) => ({
  program: STARTER_PROGRAM.program,
  restDays: STARTER_PROGRAM.restDays,
  colours: STARTER_PROGRAM.colours,
  schedule: STARTER_PROGRAM.schedule,
  loading: true,
  error: null,
  substitutions: {},

  loadOrSeedProgram: async (userId, routineConfig) => {
    if (isConfig(routineConfig)) {
      set({
        program: routineConfig.program,
        restDays: routineConfig.restDays,
        colours: routineConfig.colours,
        schedule: routineConfig.schedule || STARTER_PROGRAM.schedule,
        loading: false,
        error: null,
      })
      return
    }

    // No program yet — brand-new user. Show the starter template
    // immediately (it's a bundled constant, no network round trip needed
    // before it's usable), then persist it as their own so it survives a
    // reload and can be edited from here on.
    set({
      program: STARTER_PROGRAM.program,
      restDays: STARTER_PROGRAM.restDays,
      colours: STARTER_PROGRAM.colours,
      schedule: STARTER_PROGRAM.schedule,
      loading: false,
      error: null,
    })
    try {
      await supabase.from('profiles').update({ routine_config: STARTER_PROGRAM }).eq('id', userId)
    } catch {
      // best-effort — the starter template is already showing locally;
      // worst case this retries the seed on the next load
    }
  },

  loadSubstitutions: async () => {
    const substitutions = await fetchExerciseSubstitutions()
    set({ substitutions })
  },

  setSubstitution: (originalCode, replacement) =>
    set((state) => ({ substitutions: { ...state.substitutions, [originalCode]: replacement } })),

  resetProgram: () =>
    set({
      program: STARTER_PROGRAM.program,
      restDays: STARTER_PROGRAM.restDays,
      colours: STARTER_PROGRAM.colours,
      schedule: STARTER_PROGRAM.schedule,
      substitutions: {},
      loading: true,
    }),
}))

import { create } from 'zustand'
import type { Program, RestDays, Config } from '@/types'
import { fetchExerciseSubstitutions, type ExerciseSubstitution } from '@/services/chat'

interface ConfigStore {
  program: Program
  restDays: RestDays
  colours: Record<string, string>
  schedule: { weekDays: number[]; priority: string[]; restColour: Record<string, string> }
  sheetUrl: string
  loading: boolean
  error: string | null
  // Standing exercise substitutions accepted from the Coach (original code
  // -> replacement), applied at session-start time — see TodayTab.tsx's
  // handleStart. Owner-only feature, so this is always empty for anyone
  // else; fetching it is harmless either way (the endpoint 403s cleanly).
  substitutions: Record<string, ExerciseSubstitution>

  loadConfig: () => Promise<void>
  loadWeights: () => Promise<void>
  loadSubstitutions: () => Promise<void>
  // Optimistic local update so a swap accepted this session is reflected
  // immediately, without waiting for a re-fetch.
  setSubstitution: (originalCode: string, replacement: ExerciseSubstitution) => void
  // Applies a sheet URL to in-memory state only. Callers that need it to
  // survive a reload should go through authStore.saveSheetUrl, which
  // persists it to the signed-in user's profile and calls this after.
  updateSheetUrl: (url: string) => void
}

const DEFAULT_CONFIG: Config = {
  program: {},
  restDays: {},
  colours: { legs: '#00C2A8', push: '#4C9BE8', pull: '#B57CF6', sprint: '#FF6B4A' },
  schedule: { weekDays: [1, 2, 3, 4, 5, 6, 0], priority: [], restColour: {} },
}

export const useConfigStore = create<ConfigStore>((set) => ({
  program: DEFAULT_CONFIG.program,
  restDays: DEFAULT_CONFIG.restDays,
  colours: DEFAULT_CONFIG.colours,
  schedule: DEFAULT_CONFIG.schedule,
  sheetUrl: '',
  loading: true,
  error: null,
  substitutions: {},

  loadConfig: async () => {
    try {
      set({ loading: true, error: null })
      const response = await fetch('/config.json')
      if (!response.ok) throw new Error('Failed to load config')
      const config: Config = await response.json()
      set({
        program: config.program,
        restDays: config.restDays,
        colours: config.colours,
        schedule: config.schedule || DEFAULT_CONFIG.schedule,
        loading: false,
      })
    } catch (error) {
      set({
        error: (error as Error).message,
        loading: false,
      })
    }
  },

  loadWeights: async () => {
    const url = useConfigStore.getState().sheetUrl
    if (!url) return

    try {
      const response = await fetch(`${url}?action=weights`)
      const data = await response.json()

      if (data.weights && Array.isArray(data.weights)) {
        set((state) => {
          const program = { ...state.program }
          data.weights.forEach((w: { code: string; weight?: number | null; reps?: number | null; sets?: number | null }) => {
            Object.values(program).forEach((session) => {
              session.ex?.forEach((ex) => {
                if (ex.k !== w.code) return
                if (w.weight != null) ex.w = w.weight
                if (w.reps != null) ex.r = w.reps
                if (w.sets != null) ex.s = w.sets
              })
            })
          })
          return { program }
        })
      }
    } catch (error) {
      console.warn('Could not load weights from sheet:', error)
    }
  },

  loadSubstitutions: async () => {
    const substitutions = await fetchExerciseSubstitutions()
    set({ substitutions })
  },

  setSubstitution: (originalCode, replacement) =>
    set((state) => ({ substitutions: { ...state.substitutions, [originalCode]: replacement } })),

  updateSheetUrl: (url) => set({ sheetUrl: url }),
}))

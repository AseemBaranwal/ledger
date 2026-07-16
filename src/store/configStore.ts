import { create } from 'zustand'
import type { Program, RestDays, Config } from '@/types'

interface ConfigStore {
  program: Program
  restDays: RestDays
  colours: Record<string, string>
  sheetUrl: string
  loading: boolean
  error: string | null

  loadConfig: () => Promise<void>
  loadWeights: () => Promise<void>
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
  sheetUrl: localStorage.getItem('ledger.sheetUrl') || '',
  loading: true,
  error: null,

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
    const url = localStorage.getItem('ledger.sheetUrl')
    if (!url) return

    try {
      const response = await fetch(`${url}?action=weights`)
      const data = await response.json()

      if (data.weights && Array.isArray(data.weights)) {
        set((state) => {
          const program = { ...state.program }
          data.weights.forEach((w: { code: string; weight: number }) => {
            Object.values(program).forEach((session) => {
              session.ex?.forEach((ex) => {
                if (ex.k === w.code) ex.w = w.weight
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

  updateSheetUrl: (url) => {
    localStorage.setItem('ledger.sheetUrl', url)
    set({ sheetUrl: url })
  },
}))

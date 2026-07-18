import { create } from 'zustand'
import type { Notification } from '@/types'

interface UIStore {
  activeTab: 'today' | 'history' | 'trends' | 'sync' | 'coach'
  expandedHistoryRow: string | null
  selectedTrendGroup: string
  notifications: Notification[]
  timerActive: boolean
  timerSeconds: number
  weightIncrement: number
  openExerciseIndex: number | null
  openWeekDay: number | null

  setTab: (tab: 'today' | 'history' | 'trends' | 'sync' | 'coach') => void
  toggleExpandHistory: (id: string) => void
  setTrendGroup: (group: string) => void
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void
  dismissNotification: (id: string) => void
  setTimer: (seconds: number, active: boolean) => void
  tickTimer: () => void
  setWeightIncrement: (inc: number) => void
  setOpenExerciseIndex: (i: number | null) => void
  toggleWeekDay: (dow: number) => void
}

export const useUIStore = create<UIStore>((set) => ({
  activeTab: 'today',
  expandedHistoryRow: null,
  selectedTrendGroup: 'All',
  notifications: [],
  timerActive: false,
  timerSeconds: 0,
  weightIncrement: 5,
  openExerciseIndex: null,
  openWeekDay: null,

  setTab: (tab) => set({ activeTab: tab }),

  toggleExpandHistory: (id) => set((state) => ({
    expandedHistoryRow: state.expandedHistoryRow === id ? null : id,
  })),

  setTrendGroup: (group) => set({ selectedTrendGroup: group }),

  showNotification: (message, type) => set((state) => ({
    notifications: [
      ...state.notifications,
      {
        id: Date.now().toString(),
        message,
        type,
        timestamp: Date.now(),
      },
    ],
  })),

  dismissNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),

  setTimer: (seconds, active) => set({ timerSeconds: seconds, timerActive: active }),

  tickTimer: () => set((state) => {
    if (!state.timerActive) return state
    const newSeconds = state.timerSeconds - 1
    return {
      timerSeconds: newSeconds,
      timerActive: newSeconds > 0,
    }
  }),

  setWeightIncrement: (inc) => set({ weightIncrement: inc }),

  setOpenExerciseIndex: (i) => set({ openExerciseIndex: i }),

  toggleWeekDay: (dow) => set((state) => ({
    openWeekDay: state.openWeekDay === dow ? null : dow,
  })),
}))

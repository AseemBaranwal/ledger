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

  // Deliberately doesn't touch timerActive when the count reaches 0 — that's
  // RestTimer's own expiry effect's job (play the chime, THEN call
  // setTimer(0, false)). Flipping it here too used to race that effect: both
  // changes landed in the same tick, so timerSeconds hit 0 in the exact
  // update where timerActive already went false, and the effect's
  // `timerActive && timerSeconds <= 0` guard could never see both true at
  // once — the chime call was unreachable. Clamped at 0 so a stray extra
  // tick before the effect's cleanup runs can't drift into negative time.
  tickTimer: () => set((state) => {
    if (!state.timerActive) return state
    return { timerSeconds: Math.max(0, state.timerSeconds - 1) }
  }),

  setWeightIncrement: (inc) => set({ weightIncrement: inc }),

  setOpenExerciseIndex: (i) => set({ openExerciseIndex: i }),

  toggleWeekDay: (dow) => set((state) => ({
    openWeekDay: state.openWeekDay === dow ? null : dow,
  })),
}))

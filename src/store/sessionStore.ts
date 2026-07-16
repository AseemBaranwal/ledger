import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session } from '@/types'

interface SessionStore {
  sessions: Session[]
  draft: Session | null

  addSession: (session: Session) => void
  updateDraft: (draft: Session) => void
  saveDraft: () => void
  clearDraft: () => void
  logRep: (exerciseIndex: number, reps: number, weights: number[]) => void
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      sessions: [],
      draft: null,

      addSession: (session) => set((state) => ({
        sessions: [...state.sessions, { ...session, id: Date.now().toString() }],
      })),

      updateDraft: (draft) => set({ draft }),

      saveDraft: () => set((state) => {
        if (!state.draft) return state
        return {
          sessions: [...state.sessions, { ...state.draft, id: Date.now().toString() }],
          draft: null,
        }
      }),

      clearDraft: () => set({ draft: null }),

      logRep: (exerciseIndex, reps, weights) => set((state) => {
        if (!state.draft || !state.draft.ex) return state
        const ex = [...state.draft.ex]
        ex[exerciseIndex] = {
          ...ex[exerciseIndex],
          r: ex[exerciseIndex].r ? [...ex[exerciseIndex].r, reps] : [reps],
          ws: ex[exerciseIndex].ws ? [...ex[exerciseIndex].ws, ...weights] : weights,
        }
        return {
          draft: { ...state.draft, ex },
        }
      }),
    }),
    {
      name: 'ledger.sessions',
    }
  )
)

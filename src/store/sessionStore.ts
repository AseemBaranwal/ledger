import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session, Exercise, RestItem } from '@/types'

interface DraftExercise extends Exercise {
  w: number // live working weight for this session
}

interface SessionStore {
  sessions: Session[]
  draft: Session | null
  draftEx: DraftExercise[] | null // live weights while logging a PROGRAM session
  draftItems: RestItem[] | null // live done-state while logging a REST session

  startSession: (code: string, exList: { k: string; w: number }[], gym: string) => void
  startRestSession: (dow: number, title: string, items: RestItem[]) => void
  bumpWeight: (index: number, dir: number, inc: number) => void
  setWeight: (index: number, value: number) => void
  logRep: (index: number, reps: number) => void
  clearSet: (index: number, setIndex: number) => void
  toggleRestItem: (index: number) => void
  setRestItemDuration: (index: number, value: string) => void
  updateNotes: (notes: string) => void
  saveDraft: () => number // returns count of PRs
  clearDraft: () => void
}

// Migrate old data from vanilla JS app
const migrateOldData = (): Session[] => {
  try {
    const oldData = localStorage.getItem('ledger.v1')
    if (oldData) {
      const parsed = JSON.parse(oldData)
      if (parsed.sessions && Array.isArray(parsed.sessions)) {
        return parsed.sessions
      }
    }
  } catch (e) {
    console.warn('Could not migrate old data:', e)
  }
  return []
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: migrateOldData(),
      draft: null,
      draftEx: null,
      draftItems: null,

      startSession: (code, exList, gym) => {
        const today = new Date()
        const y = today.getFullYear()
        const m = String(today.getMonth() + 1).padStart(2, '0')
        const d = String(today.getDate()).padStart(2, '0')
        set({
          draft: { d: `${y}-${m}-${d}`, s: code, g: gym, n: '', type: 'PROGRAM' },
          draftEx: exList.map((e) => ({ k: e.k, w: e.w, r: [], ws: [] })),
          draftItems: null,
        })
      },

      startRestSession: (dow, title, items) => {
        const today = new Date()
        const y = today.getFullYear()
        const m = String(today.getMonth() + 1).padStart(2, '0')
        const d = String(today.getDate()).padStart(2, '0')
        set({
          draft: { d: `${y}-${m}-${d}`, s: `REST_${dow}`, g: title, n: '', type: 'REST' },
          draftEx: null,
          draftItems: items.map((it) => ({ ...it, done: false })),
        })
      },

      bumpWeight: (index, dir, inc) => set((state) => {
        if (!state.draftEx) return state
        const draftEx = [...state.draftEx]
        draftEx[index] = { ...draftEx[index], w: Math.max(0, Math.round((draftEx[index].w + dir * inc) * 10) / 10) }
        return { draftEx }
      }),

      setWeight: (index, value) => set((state) => {
        if (!state.draftEx) return state
        const draftEx = [...state.draftEx]
        draftEx[index] = { ...draftEx[index], w: Math.max(0, value || 0) }
        return { draftEx }
      }),

      logRep: (index, reps) => set((state) => {
        if (!state.draftEx) return state
        const draftEx = [...state.draftEx]
        const ex = draftEx[index]
        draftEx[index] = {
          ...ex,
          r: [...ex.r, reps],
          ws: [...(ex.ws || []), ex.w],
        }
        return { draftEx }
      }),

      clearSet: (index, setIndex) => set((state) => {
        if (!state.draftEx) return state
        const draftEx = [...state.draftEx]
        const ex = { ...draftEx[index] }
        ex.r = ex.r.filter((_, i) => i !== setIndex)
        ex.ws = (ex.ws || []).filter((_, i) => i !== setIndex)
        draftEx[index] = ex
        return { draftEx }
      }),

      toggleRestItem: (index) => set((state) => {
        if (!state.draftItems) return state
        const draftItems = [...state.draftItems]
        draftItems[index] = { ...draftItems[index], done: !draftItems[index].done }
        return { draftItems }
      }),

      setRestItemDuration: (index, value) => set((state) => {
        if (!state.draftItems) return state
        const draftItems = [...state.draftItems]
        draftItems[index] = { ...draftItems[index], d: value }
        return { draftItems }
      }),

      updateNotes: (notes) => set((state) => {
        if (!state.draft) return state
        return { draft: { ...state.draft, n: notes } }
      }),

      saveDraft: () => {
        const state = get()
        if (!state.draft) return 0

        const isRest = state.draft.type === 'REST'
        let sessionToSave: Session

        if (isRest) {
          sessionToSave = { ...state.draft, items: state.draftItems || [] }
        } else {
          const loggedEx = (state.draftEx || []).filter((e) => e.r.length > 0)
          sessionToSave = { ...state.draft, ex: loggedEx }
        }

        const newSessions = [...state.sessions, { ...sessionToSave, id: Date.now().toString() }]
        newSessions.sort((a, b) => a.d.localeCompare(b.d))

        let prCount = 0
        if (!isRest) {
          sessionToSave.ex?.forEach((e) => {
            if (!e.r.length) return
            const curMax = e.ws ? Math.max(...e.ws) : e.w || 0
            const prior = state.sessions
              .filter((x) => x.d < sessionToSave.d)
              .flatMap((x) => x.ex?.filter((y) => y.k === e.k) || [])
              .map((y) => (y.ws ? Math.max(...y.ws) : y.w || 0))
            if (prior.length && curMax > Math.max(...prior)) prCount++
          })
        }

        set({ sessions: newSessions, draft: null, draftEx: null, draftItems: null })
        return prCount
      },

      clearDraft: () => set({ draft: null, draftEx: null, draftItems: null }),
    }),
    {
      name: 'ledger.sessions',
    }
  )
)

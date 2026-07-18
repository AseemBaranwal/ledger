import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Session, Exercise, RestItem } from '@/types'
import { pushSession } from '@/services/appScript'
import { postSessionToStrava } from '@/services/strava'
import { scopedStorage } from '@/services/userScope'
import { useConfigStore } from './configStore'
import { useUIStore } from './uiStore'
import { useStravaStore } from './stravaStore'

interface DraftExercise extends Exercise {
  w: number // live working weight for this session
}

interface SessionStore {
  sessions: Session[]
  draft: Session | null
  draftEx: DraftExercise[] | null // live weights while logging a PROGRAM session
  draftItems: RestItem[] | null // live done-state while logging a REST session
  pendingSync: string[] // session ids not yet confirmed pushed to the sheet
  lastSyncedAt: number | null // ms epoch of the last successful push or manual sync

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
  flushPendingSync: () => void
  markSynced: () => void
}

// NOTE: this used to auto-import from the pre-auth vanilla app's unscoped
// 'ledger.v1' localStorage key at store creation. Removed: that key isn't
// tied to any signed-in user, so on a device that had it set, a *different*
// Google account signing in for the first time (empty scoped storage) would
// inherit that stale data — zustand's persist.rehydrate() merges onto
// whatever's already in memory rather than resetting it when the target
// storage key is empty, so the leftover initial state would stick. The
// user's Sheet is the durable source of truth now; auto-restore-on-empty
// in App.tsx repopulates real per-user data safely instead.

// Fire the sheet push and update the pending-sync queue based on the outcome.
// mode:'no-cors' means we can't see whether Apps Script actually processed the
// request, only whether the network call itself completed — so "resolved" is
// the best signal of success we have. A thrown error (offline, DNS, etc.)
// queues the session id so flushPendingSync() can retry it later.
async function syncSession(session: Session, markPending: (id: string) => void, clearPending: (id: string) => void) {
  const sheetUrl = useConfigStore.getState().sheetUrl
  if (!sheetUrl || !session.id) return
  try {
    await pushSession(sheetUrl, session)
    clearPending(session.id)
    useSessionStore.setState({ lastSyncedAt: Date.now() })
  } catch (e) {
    markPending(session.id)
  }
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      draft: null,
      draftEx: null,
      draftItems: null,
      pendingSync: [],
      lastSyncedAt: null,

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

        const savedSession = { ...sessionToSave, id: Date.now().toString() }
        const newSessions = [...state.sessions, savedSession]
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

        // Push PROGRAM sessions to the sheet (fire-and-forget, non-blocking).
        // REST sessions are local-only, matching the original app's behavior.
        if (!isRest) {
          const markPending = (id: string) => {
            set((s) => (s.pendingSync.includes(id) ? s : { pendingSync: [...s.pendingSync, id] }))
            useUIStore.getState().showNotification('Could not sync to sheet — will retry', 'error')
          }
          const clearPending = (id: string) => {
            set((s) => ({ pendingSync: s.pendingSync.filter((x) => x !== id) }))
          }
          syncSession(savedSession, markPending, clearPending)

          // Best-effort, non-blocking Strava post — never affects the local
          // save or the sheet sync above, and silently no-ops if the user
          // hasn't connected Strava.
          if (savedSession.ex?.length && useStravaStore.getState().connected) {
            const programDef = savedSession.s ? useConfigStore.getState().program[savedSession.s] : undefined
            const programName = programDef?.full || programDef?.name || savedSession.s || 'Workout'
            postSessionToStrava(savedSession, programName).then((result) => {
              if (!result.ok && result.error) {
                useUIStore.getState().showNotification(`Strava: ${result.error}`, 'error')
              }
            })
          }
        }

        return prCount
      },

      clearDraft: () => set({ draft: null, draftEx: null, draftItems: null }),

      flushPendingSync: () => {
        const state = get()
        if (!state.pendingSync.length) return
        state.pendingSync.forEach((id) => {
          const session = state.sessions.find((s) => s.id === id)
          if (!session) {
            set((s) => ({ pendingSync: s.pendingSync.filter((x) => x !== id) }))
            return
          }
          const markPending = () => {} // already pending
          const clearPending = (sid: string) => {
            set((s) => ({ pendingSync: s.pendingSync.filter((x) => x !== sid) }))
          }
          syncSession(session, markPending, clearPending)
        })
      },

      markSynced: () => set({ lastSyncedAt: Date.now() }),
    }),
    {
      name: 'ledger.sessions',
      storage: createJSONStorage(() => scopedStorage),
    }
  )
)

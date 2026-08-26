import { create } from 'zustand'
import { getStravaAuthorizeUrl, getStravaConnection, disconnectStrava } from '@/services/strava'

interface StravaStore {
  connected: boolean
  athleteName: string | null
  checking: boolean
  disconnecting: boolean

  checkConnection: (userId: string) => Promise<void>
  connect: () => void
  disconnect: () => Promise<void>
  applyCallback: (athleteName: string | null) => void
  reset: () => void
}

export const useStravaStore = create<StravaStore>((set) => ({
  connected: false,
  athleteName: null,
  // Starts true (not false) — App.tsx always calls checkConnection() right
  // after sign-in, so "checking" is the honest state until that resolves.
  // Defaulting to false let SyncTab render "Connect Strava" for one frame
  // even for an already-connected account, before flipping to "Connected"
  // once the check came back — a visible flash of the wrong state.
  checking: true,
  disconnecting: false,

  checkConnection: async (userId: string) => {
    set({ checking: true })
    const conn = await getStravaConnection(userId)
    set({ connected: !!conn, athleteName: conn?.athleteName ?? null, checking: false })
  },

  connect: () => {
    const url = getStravaAuthorizeUrl()
    if (url) window.location.href = url
  },

  disconnect: async () => {
    set({ disconnecting: true })
    try {
      await disconnectStrava()
      set({ connected: false, athleteName: null })
    } finally {
      set({ disconnecting: false })
    }
  },

  applyCallback: (athleteName) => {
    set({ connected: true, athleteName })
  },

  reset: () => set({ connected: false, athleteName: null }),
}))

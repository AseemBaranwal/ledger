import { create } from 'zustand'
import {
  getGoogleHealthAuthorizeUrl,
  getGoogleHealthConnection,
  disconnectGoogleHealth,
} from '@/services/googleHealth'

interface GoogleHealthStore {
  connected: boolean
  // True when Google has already force-expired the refresh token (the
  // consent screen is in "Testing" status, which caps refresh tokens at 7
  // days). The row still exists and the connection is still "connected" —
  // it just needs a fresh authorization to keep reading data. This is a
  // routine, scheduled state, not an error.
  needsReconnect: boolean
  connectedAt: string | null
  checking: boolean
  disconnecting: boolean

  checkConnection: (userId: string) => Promise<void>
  connect: () => void
  disconnect: () => Promise<void>
  applyCallback: () => void
  reset: () => void
}

export const useGoogleHealthStore = create<GoogleHealthStore>((set) => ({
  connected: false,
  needsReconnect: false,
  connectedAt: null,
  checking: false,
  disconnecting: false,

  checkConnection: async (userId: string) => {
    set({ checking: true })
    const conn = await getGoogleHealthConnection(userId)
    set({
      connected: !!conn,
      needsReconnect: Boolean(conn?.refreshFailedAt),
      connectedAt: conn?.connectedAt ?? null,
      checking: false,
    })
  },

  connect: () => {
    const url = getGoogleHealthAuthorizeUrl()
    if (url) window.location.href = url
  },

  disconnect: async () => {
    set({ disconnecting: true })
    try {
      await disconnectGoogleHealth()
      set({ connected: false, needsReconnect: false, connectedAt: null })
    } finally {
      set({ disconnecting: false })
    }
  },

  // A completed authorization always clears needsReconnect — the exchange
  // endpoint writes a fresh refresh token and nulls refresh_failed_at, so
  // leaving the reconnect prompt up until the next checkConnection() would
  // show a stale "needs reconnect" on a connection that was just renewed.
  applyCallback: () => {
    set({ connected: true, needsReconnect: false })
  },

  reset: () => set({ connected: false, needsReconnect: false, connectedAt: null }),
}))

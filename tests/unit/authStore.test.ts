import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { useSessionStore } from '@/store/sessionStore'
import { useBodyStore } from '@/store/bodyStore'
import { useConfigStore } from '@/store/configStore'
import { useChatStore } from '@/store/chatStore'
import { supabase } from '@/services/supabaseClient'
import { getCurrentUserId } from '@/services/userScope'
import type { Session } from '@/types'

vi.mock('@/services/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
}))

const USER_A = { id: 'user-a', email: 'a@example.com', user_metadata: { full_name: 'User A' } }
const USER_B = { id: 'user-b', email: 'b@example.com', user_metadata: { full_name: 'User B' } }

const REAL_CONFIG = { program: { LA: { name: 'Lower A', full: '', colour: 'legs', gym: '', day: 1, ex: [] } }, restDays: {}, colours: {}, schedule: { weekDays: [], priority: [], restColour: {} } }

function profilesChain(response: { data: unknown; error: { message: string } | null }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(response),
    update: () => chain,
  }
  return chain
}

// Captures the callback authStore.init() registers so tests can fire
// INITIAL_SESSION / SIGNED_OUT / sign-in events manually, the same way
// Supabase's auth-js would (it fires INITIAL_SESSION to every new listener
// immediately on subscription — there's no separate getSession() call to
// mock anymore, see the "duplicate profile fetch" fix this test file was
// updated alongside).
let authChangeCallback: (event: string, session: { user: typeof USER_A } | null) => Promise<void> | void

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({ user: null, profile: null, loading: true, profileError: null })
    useSessionStore.setState({ sessions: [], draft: null, draftEx: null, draftDefs: null, draftItems: null, pendingSync: [], lastSyncedAt: null })
    useBodyStore.setState({ scans: [] })
    useConfigStore.getState().resetProgram()
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((cb: any) => {
      authChangeCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } } as any
    })
  })

  describe('init — INITIAL_SESSION with nothing signed in', () => {
    it('resolves loading without setting a user', async () => {
      useAuthStore.getState().init()
      await authChangeCallback('INITIAL_SESSION', null)

      expect(useAuthStore.getState().loading).toBe(false)
      expect(useAuthStore.getState().user).toBeNull()
    })
  })

  describe('init — INITIAL_SESSION with an existing session', () => {
    it('loads the profile and seeds the program on success', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        profilesChain({ data: { id: 'user-a', routine_config: REAL_CONFIG }, error: null })
      )

      useAuthStore.getState().init()
      await authChangeCallback('INITIAL_SESSION', { user: USER_A })

      expect(useAuthStore.getState().loading).toBe(false)
      expect(useAuthStore.getState().user?.id).toBe('user-a')
      expect(useAuthStore.getState().profileError).toBeNull()
      expect(useConfigStore.getState().program).toEqual(REAL_CONFIG.program)
    })

    // The exact bug class the comments in authStore.ts call out: rehydrate()
    // is a no-op against an empty storage key, so without an explicit blank
    // first, a previous user's in-memory data would just sit there.
    it('blanks stale in-memory sessions before rehydrating a different user, never leaving old data on screen', async () => {
      useSessionStore.setState({ sessions: [{ id: 'stale-from-user-a', d: '2020-01-01' } as Session] })
      vi.mocked(supabase.from).mockReturnValue(
        profilesChain({ data: { id: 'user-b', routine_config: REAL_CONFIG }, error: null })
      )

      useAuthStore.getState().init()
      await authChangeCallback('INITIAL_SESSION', { user: USER_B })

      expect(useSessionStore.getState().sessions).toEqual([])
      expect(getCurrentUserId()).toBe('user-b')
    })

    it('sets profile to null (not a stale value) when a brand-new session fails to load its profile', async () => {
      vi.mocked(supabase.from).mockReturnValue(
        profilesChain({ data: null, error: { message: 'network error' } })
      )

      useAuthStore.getState().init()
      await authChangeCallback('INITIAL_SESSION', { user: USER_A })

      expect(useAuthStore.getState().profile).toBeNull()
      expect(useAuthStore.getState().profileError).toBe('network error')
    })
  })

  describe('retryProfileLoad — transient error on an already-established session', () => {
    it('keeps the last known-good profile instead of wiping it', async () => {
      const goodProfile = { id: 'user-a', email: 'a@example.com', display_name: null, sheet_url: null, routine_config: REAL_CONFIG }
      useAuthStore.setState({ user: { id: 'user-a', email: 'a@example.com', name: null, avatarUrl: null }, profile: goodProfile as any, loading: false, profileError: null })

      vi.mocked(supabase.from).mockReturnValue(
        profilesChain({ data: null, error: { message: 'timeout' } })
      )

      await useAuthStore.getState().retryProfileLoad()

      expect(useAuthStore.getState().profile).toEqual(goodProfile)
      expect(useAuthStore.getState().profileError).toBe('timeout')
    })
  })

  describe('onAuthStateChange listener', () => {
    it('SIGNED_OUT clears user, profile, and rehydrates stores to blank', async () => {
      useAuthStore.setState({ user: { id: 'user-a', email: null, name: null, avatarUrl: null }, profile: { id: 'user-a' } as any, loading: false, profileError: 'stale error' })
      useSessionStore.setState({ sessions: [{ id: 'x', d: '2020-01-01' } as Session] })
      useAuthStore.getState().init()

      await authChangeCallback('SIGNED_OUT', null)

      expect(useAuthStore.getState().user).toBeNull()
      expect(useAuthStore.getState().profile).toBeNull()
      expect(useAuthStore.getState().profileError).toBeNull()
      expect(useSessionStore.getState().sessions).toEqual([])
      expect(getCurrentUserId()).toBeNull()
    })

    it('does not re-blank sessions when the same user fires a redundant auth event', async () => {
      useAuthStore.getState().init()
      vi.mocked(supabase.from).mockReturnValue(
        profilesChain({ data: { id: 'user-a', routine_config: REAL_CONFIG }, error: null })
      )

      // First sign-in: a genuinely new user, so this legitimately rehydrates.
      await authChangeCallback('SIGNED_IN', { user: USER_A })
      useSessionStore.setState({ sessions: [{ id: 'real-session', d: '2026-01-01' } as Session] })

      // Same user firing again (e.g. a token refresh) is NOT a new user —
      // must not blank the session that was just logged.
      await authChangeCallback('TOKEN_REFRESHED', { user: USER_A })

      expect(useSessionStore.getState().sessions).toEqual([{ id: 'real-session', d: '2026-01-01' }])
    })
  })
})

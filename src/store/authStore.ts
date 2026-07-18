import { create } from 'zustand'
import { supabase, type Profile } from '@/services/supabaseClient'
import { setCurrentUserId } from '@/services/userScope'
import { useSessionStore } from './sessionStore'
import { useBodyStore } from './bodyStore'
import { useConfigStore } from './configStore'

interface AuthUser {
  id: string
  email: string | null
}

interface AuthStore {
  user: AuthUser | null
  profile: Profile | null
  loading: boolean // true until the initial session check resolves
  profileError: string | null // set when the profile fetch itself failed (distinct from "no sheet configured yet")
  savingUrl: boolean

  init: () => () => void // returns an unsubscribe function
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  saveSheetUrl: (url: string) => Promise<void>
  retryProfileLoad: () => Promise<void>
}

// Re-points the local per-user caches (sessions, body scans) at the given
// user's namespaced storage key and forces them to re-read from it.
//
// Two things matter here, both found while auditing for cross-user leaks:
//  1. zustand's persist.rehydrate() does NOT reset state when the target
//     storage key is empty — its default merge is `{...currentState,
//     ...persisted}`, so with nothing persisted it's a no-op and whatever
//     is already in memory just stays there.
//  2. That means switching from user A to user B without an explicit
//     SIGNED_OUT in between (e.g. a provider-level account switch) could
//     leave user A's data on screen until user B's own storage — if any —
//     happens to overwrite it.
// So: explicitly blank the in-memory state FIRST, then rehydrate. If the
// new user has real cached data, rehydrate fills it back in; if not, the
// blank state is what's shown, never the previous user's.
function rehydrateUserScopedStores(userId: string | null) {
  setCurrentUserId(userId)
  useSessionStore.setState({ sessions: [], draft: null, draftEx: null, draftItems: null, pendingSync: [], lastSyncedAt: null })
  useBodyStore.setState({ scans: [] })
  useSessionStore.persist.rehydrate()
  useBodyStore.persist.rehydrate()
}

async function loadProfile(userId: string): Promise<{ profile: Profile | null; error: string | null }> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) {
    console.warn('Could not load profile:', error.message)
    return { profile: null, error: error.message }
  }
  return { profile: data as Profile, error: null }
}

// Applies whatever a profile load resolved to. Shared by init's initial
// check, the auth-state-change listener, and manual retry — kept in one
// place so they can't drift out of sync with each other.
async function applyUser(
  set: (partial: Partial<AuthStore>) => void,
  get: () => AuthStore,
  user: AuthUser,
  isNewUser: boolean
) {
  if (isNewUser) {
    rehydrateUserScopedStores(user.id)
    useConfigStore.setState({ sheetUrl: '' }) // never show a previous user's sheet while the new one's profile is loading
  }
  const { profile, error } = await loadProfile(user.id)
  // On a transient error for an already-established session, keep the last
  // known-good profile rather than wiping it — only a brand-new session
  // with no profile yet should show a hard error screen. profileError still
  // gets set either way so a banner/retry can surface if callers want it.
  const nextProfile = profile ?? (isNewUser ? null : get().profile)
  set({ user, profile: nextProfile, profileError: error, loading: false })
  if (nextProfile?.sheet_url) {
    useConfigStore.getState().updateSheetUrl(nextProfile.sheet_url)
  }
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  profileError: null,
  savingUrl: false,

  init: () => {
    // Pick up whatever session already exists (e.g. a returning visit)
    // before subscribing to future changes.
    supabase.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user
      if (sessionUser) {
        const user = { id: sessionUser.id, email: sessionUser.email ?? null }
        await applyUser(set, get, user, true)
      } else {
        set({ loading: false })
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        rehydrateUserScopedStores(null)
        useConfigStore.setState({ sheetUrl: '' })
        set({ user: null, profile: null, profileError: null })
        return
      }

      const sessionUser = session?.user
      if (!sessionUser) return

      const user = { id: sessionUser.id, email: sessionUser.email ?? null }
      const isNewUser = get().user?.id !== user.id
      await applyUser(set, get, user, isNewUser)
    })

    return () => listener.subscription.unsubscribe()
  },

  signInWithGoogle: async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    rehydrateUserScopedStores(null)
    useConfigStore.setState({ sheetUrl: '' })
    set({ user: null, profile: null, profileError: null })
  },

  retryProfileLoad: async () => {
    const user = get().user
    if (!user) return
    set({ loading: true })
    await applyUser(set, get, user, false)
  },

  saveSheetUrl: async (url: string) => {
    const user = get().user
    if (!user) return
    set({ savingUrl: true })
    try {
      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, email: user.email, sheet_url: url }, { onConflict: 'id' })
        .select()
        .single()
      if (error) throw error
      set({ profile: data as Profile, profileError: null })
      useConfigStore.getState().updateSheetUrl(url)
    } finally {
      set({ savingUrl: false })
    }
  },
}))

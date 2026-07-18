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
  savingUrl: boolean

  init: () => () => void // returns an unsubscribe function
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  saveSheetUrl: (url: string) => Promise<void>
}

// Re-points the local per-user caches (sessions, body scans) at the given
// user's namespaced storage key and forces them to re-read from it — needed
// because zustand's persist middleware only reads storage once at store
// creation, long before auth has resolved.
function rehydrateUserScopedStores(userId: string | null) {
  setCurrentUserId(userId)
  useSessionStore.persist.rehydrate()
  useBodyStore.persist.rehydrate()
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) {
    console.warn('Could not load profile:', error.message)
    return null
  }
  return data as Profile
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  savingUrl: false,

  init: () => {
    // Pick up whatever session already exists (e.g. a returning visit)
    // before subscribing to future changes.
    supabase.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user
      if (sessionUser) {
        const user = { id: sessionUser.id, email: sessionUser.email ?? null }
        rehydrateUserScopedStores(user.id)
        const profile = await loadProfile(user.id)
        set({ user, profile, loading: false })
        if (profile?.sheet_url) {
          useConfigStore.getState().updateSheetUrl(profile.sheet_url)
        }
      } else {
        set({ loading: false })
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        rehydrateUserScopedStores(null)
        useConfigStore.setState({ sheetUrl: '' })
        set({ user: null, profile: null })
        return
      }

      const sessionUser = session?.user
      if (!sessionUser) return

      const user = { id: sessionUser.id, email: sessionUser.email ?? null }
      const isNewUser = get().user?.id !== user.id
      if (isNewUser) {
        rehydrateUserScopedStores(user.id)
      }
      const profile = await loadProfile(user.id)
      set({ user, profile, loading: false })
      if (profile?.sheet_url) {
        useConfigStore.getState().updateSheetUrl(profile.sheet_url)
      }
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
    set({ user: null, profile: null })
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
      set({ profile: data as Profile })
      useConfigStore.getState().updateSheetUrl(url)
    } finally {
      set({ savingUrl: false })
    }
  },
}))

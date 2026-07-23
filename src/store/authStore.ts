import { create } from 'zustand'
import { supabase, type Profile } from '@/services/supabaseClient'
import { setCurrentUserId } from '@/services/userScope'
import { useSessionStore } from './sessionStore'
import { useBodyStore } from './bodyStore'
import { useConfigStore } from './configStore'
import { useChatStore } from './chatStore'

interface AuthUser {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

// Google's OIDC claims land in user_metadata via Supabase — no extra scopes
// or API calls needed for these. Age/birthday is NOT here: that needs the
// separate People API user.birthday.read scope, which Google gates behind
// an app-verification review before it'll work for anyone but test users —
// not worth it for a personal app.
function toAuthUser(sessionUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): AuthUser {
  const meta = sessionUser.user_metadata || {}
  return {
    id: sessionUser.id,
    email: sessionUser.email ?? null,
    name: (meta.full_name as string) || (meta.name as string) || null,
    avatarUrl: (meta.avatar_url as string) || (meta.picture as string) || null,
  }
}

interface AuthStore {
  user: AuthUser | null
  profile: Profile | null
  loading: boolean // true until the initial session check resolves
  profileError: string | null // set when the profile fetch itself failed

  init: () => () => void // returns an unsubscribe function
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
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
// Awaited by callers so the app doesn't briefly render with blanked-out
// state before the real (correctly-scoped) data has finished loading back
// in — rehydrate() is async, and skipping the await here would show a flash
// of "0 sessions" on every fresh page load before self-correcting.
async function rehydrateUserScopedStores(userId: string | null) {
  setCurrentUserId(userId)
  useSessionStore.setState({ sessions: [], draft: null, draftEx: null, draftItems: null, pendingSync: [], lastSyncedAt: null })
  useBodyStore.setState({ scans: [] })
  // No pre-blank for chat: unlike sessions/body scans, chat is gated to the
  // single app owner (see App.tsx's showCoach check) — there's never a
  // "different user's" stale data to guard against, so it can skip straight
  // to rehydrate(). Blanking first would be actively wrong here: set() on a
  // persisted store writes through to storage synchronously, so blanking
  // then rehydrating races and clobbers the real cached history with an
  // empty array before rehydrate() ever gets to read it back.
  await Promise.all([useSessionStore.persist.rehydrate(), useBodyStore.persist.rehydrate(), useChatStore.persist.rehydrate()])
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
  let rehydratePromise: Promise<void> = Promise.resolve()
  if (isNewUser) {
    rehydratePromise = rehydrateUserScopedStores(user.id)
    useConfigStore.getState().resetProgram() // never show a previous user's program while the new one's profile is loading
  }
  const [{ profile, error }] = await Promise.all([loadProfile(user.id), rehydratePromise])
  // On a transient error for an already-established session, keep the last
  // known-good profile rather than wiping it — only a brand-new session
  // with no profile yet should show a hard error screen. profileError still
  // gets set either way so a banner/retry can surface if callers want it.
  const nextProfile = profile ?? (isNewUser ? null : get().profile)
  set({ user, profile: nextProfile, profileError: error, loading: false })
  if (nextProfile) {
    useConfigStore.getState().loadOrSeedProgram(user.id, nextProfile.routine_config)
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
        const user = toAuthUser(sessionUser)
        await applyUser(set, get, user, true)
      } else {
        set({ loading: false })
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        await rehydrateUserScopedStores(null)
        useConfigStore.getState().resetProgram()
        set({ user: null, profile: null, profileError: null })
        return
      }

      const sessionUser = session?.user
      if (!sessionUser) return

      const user = toAuthUser(sessionUser)
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
    await rehydrateUserScopedStores(null)
    useConfigStore.getState().resetProgram()
    set({ user: null, profile: null, profileError: null })
  },

  retryProfileLoad: async () => {
    const user = get().user
    if (!user) return
    set({ loading: true })
    await applyUser(set, get, user, false)
  },
}))

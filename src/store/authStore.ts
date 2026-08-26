import { create } from 'zustand'
import { supabase, type Profile } from '@/services/supabaseClient'
import { setCurrentUserId, getLastKnownUserId, setLastKnownUserId } from '@/services/userScope'
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
// `isAccountSwitch` gates whether state gets blanked FIRST, and getting it
// wrong causes real data loss either way. zustand's persist.rehydrate()
// does NOT reset state when the target key is empty (merge is
// `{...currentState, ...persisted}`), so switching users without blanking
// first can leave the old user's data on screen. But set() on a persisted
// store writes through to storage SYNCHRONOUSLY, and in-memory auth state
// always starts null on a fresh load — so blanking on every cold app open
// (not just a genuine switch) clobbers the real draft in storage before
// rehydrate() ever gets to read it back, silently wiping an in-progress
// workout on nothing more than closing and reopening the app.
// `isAccountSwitch` must therefore be computed against a value that
// survives a reload (see userScope.ts's getLastKnownUserId), not in-memory
// state, so the blank only ever runs for a genuine different-user switch.
//
// Awaited by callers so the app doesn't briefly render with blanked-out
// state before the real (correctly-scoped) data has finished loading back
// in — rehydrate() is async, and skipping the await here would show a flash
// of "0 sessions" on every fresh page load before self-correcting.
async function rehydrateUserScopedStores(userId: string | null, isAccountSwitch: boolean) {
  setCurrentUserId(userId)
  if (isAccountSwitch) {
    useSessionStore.setState({ sessions: [], draft: null, draftEx: null, draftItems: null, pendingSync: [], lastSyncedAt: null })
    useBodyStore.setState({ scans: [] })
  }
  // No pre-blank for chat regardless: unlike sessions/body scans, chat is
  // gated to the single app owner (see App.tsx's showCoach check) — there's
  // never a "different user's" stale data to guard against, so it can skip
  // straight to rehydrate() even on a genuine switch.
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
  isNewUser: boolean,
  isAccountSwitch: boolean
) {
  let rehydratePromise: Promise<void> = Promise.resolve()
  if (isNewUser) {
    rehydratePromise = rehydrateUserScopedStores(user.id, isAccountSwitch)
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
    // No separate getSession() call — installed @supabase/auth-js fires an
    // INITIAL_SESSION event to every new onAuthStateChange listener
    // immediately on subscription, carrying whatever session already
    // exists (or null). Calling getSession() as well as subscribing here
    // used to fire two full profile loads on every cold app open, on the
    // gym wifi this app is meant to tolerate.
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // Always blank on an explicit sign-out — there's no "avoid racing
        // the real draft" concern here since setCurrentUserId(null) points
        // at the 'anon' key, never the signed-out user's own key, so this
        // can't clobber their real data. Deliberately does NOT clear
        // getLastKnownUserId(): if they sign back in as themselves shortly
        // after, that's what lets isAccountSwitch correctly stay false for
        // them (their real draft, untouched under their own key this whole
        // time, rehydrates straight back in) while still correctly
        // triggering a blank if a DIFFERENT user signs in next.
        await rehydrateUserScopedStores(null, true)
        useConfigStore.getState().resetProgram()
        set({ user: null, profile: null, profileError: null, loading: false })
        return
      }

      const sessionUser = session?.user
      if (!sessionUser) {
        set({ loading: false }) // INITIAL_SESSION with nothing signed in
        return
      }

      const user = toAuthUser(sessionUser)
      const isNewUser = get().user?.id !== user.id
      // Compared against a value that survives a reload (unlike the
      // in-memory check above, which is always true on a fresh page load)
      // — see rehydrateUserScopedStores's comment for why this distinction
      // is what fixes issue #58's data loss.
      const isAccountSwitch = getLastKnownUserId() !== user.id
      setLastKnownUserId(user.id)
      await applyUser(set, get, user, isNewUser, isAccountSwitch)
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
    await rehydrateUserScopedStores(null, true)
    useConfigStore.getState().resetProgram()
    set({ user: null, profile: null, profileError: null })
  },

  retryProfileLoad: async () => {
    const user = get().user
    if (!user) return
    set({ loading: true })
    await applyUser(set, get, user, false, false)
  },
}))

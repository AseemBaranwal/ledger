import { lazy, Suspense, useEffect } from 'react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { useConfigStore, useUIStore, useSessionStore, useAuthStore, useStravaStore, useUnitStore } from '@/store'
import { Header, BottomNav, Toast } from '@/components/layout'
import { TodayTab, HistoryTab, TrendsTab, SyncTab } from '@/components/tabs'

// Lazy-loaded: react-markdown (used only here) adds ~35KB gzipped, not worth
// putting in the main bundle every visitor downloads for the other 4 tabs.
const CoachTab = lazy(() => import('@/components/tabs/CoachTab').then((m) => ({ default: m.CoachTab })))
import { RestTimer } from '@/components/session'
import { SignInScreen, ErrorScreen } from '@/components/auth'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { streak } from '@/services/trendCalculations'
import { fetchSessions } from '@/services/sessionsApi'
import { unlockAudioContext } from '@/services/audio'
import { onStorageError } from '@/services/userScope'
import { STRAVA_CALLBACK_PATH, exchangeStravaCode } from '@/services/strava'
import { registerSW } from 'virtual:pwa-register'
import { useActiveSessionBackGuard } from '@/hooks/useActiveSessionBackGuard'
import styles from '@/styles/App.module.css'

export default function App() {
  useActiveSessionBackGuard()
  const activeTab = useUIStore((s) => s.activeTab)
  const setTab = useUIStore((s) => s.setTab)
  const timerActive = useUIStore((s) => s.timerActive)
  const loadSubstitutions = useConfigStore((s) => s.loadSubstitutions)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const sessions = useSessionStore((s) => s.sessions)
  const authLoading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const profileError = useAuthStore((s) => s.profileError)
  const authInit = useAuthStore((s) => s.init)

  // App-wide, auth-independent bootstrap: PWA service worker and the
  // audio-unlock fallback. Runs once. (No more static config.json fetch
  // here — each user's program now comes from their own profile, loaded
  // once auth resolves, via authStore.applyUser -> configStore.loadOrSeedProgram.)
  useEffect(() => {
    const unsubscribeAuth = authInit()

    // Fires at most once per page load (see safeStorageCall's dedup) — a
    // local-storage write failure (device storage full, Safari Private
    // Browsing) previously just threw uncaught with no visible cause;
    // this at least tells the person something didn't save, rather than
    // leaving them to discover it later when a set they thought was
    // logged turns out not to have been.
    onStorageError(() => {
      useUIStore.getState().showNotification(
        "Couldn't save locally — your device storage may be full. Recently logged sets might not persist.",
        'error'
      )
    })

    const unlock = () => {
      unlockAudioContext()
      document.removeEventListener('pointerdown', unlock)
    }
    document.addEventListener('pointerdown', unlock)

    // Register the PWA service worker via the plugin's own helper (NOT a bare
    // navigator.serviceWorker.register call) so registerType:'autoUpdate' in
    // vite.config.ts actually does something: it detects a new deployed build,
    // skips waiting, and reloads the page automatically. A manual register()
    // call bypasses all of that, leaving an installed/home-screened PWA stuck
    // serving a stale cached bundle indefinitely — which silently reverts any
    // code fix until the app is fully force-closed and reopened.
    if ('serviceWorker' in navigator) {
      registerSW({
        immediate: true,
        onRegisteredSW(_url, registration) {
          if (registration) {
            setInterval(() => registration.update(), 60 * 60 * 1000)
          }
        },
      })
    }

    return () => {
      document.removeEventListener('pointerdown', unlock)
      unsubscribeAuth()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Per-user bootstrap: once signed in, load standing exercise
  // substitutions, pull down sessions from Supabase if this device's local
  // cache is empty (e.g. a fresh browser/device), and retry any sessions
  // that failed to save.
  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    loadSubstitutions(userId)
    useUnitStore.getState().resolveDefault()

    const autoRestore = async () => {
      if (useSessionStore.getState().sessions.length > 0) return
      try {
        const restored = await fetchSessions(userId)
        if (restored.length) useSessionStore.setState({ sessions: restored })
      } catch (e) {
        // A real fetch failure here used to look identical to a genuine
        // brand-new account with no history — both rendered the same empty
        // state. Surfacing it distinctly, even though local cache (if any)
        // still shows and pendingSync/next reload will pick up anything
        // missing.
        useUIStore.getState().showNotification('Could not load your history — check your connection and reload', 'error')
      }
    }
    autoRestore()

    useSessionStore.getState().flushPendingSync()
    const onOnline = () => useSessionStore.getState().flushPendingSync()
    window.addEventListener('online', onOnline)

    return () => {
      window.removeEventListener('online', onOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Strava: check connection status once signed in, and handle the OAuth
  // redirect landing back on its own dedicated path (see strava.ts for why
  // it's a separate path rather than the app root).
  useEffect(() => {
    if (!user) return
    useStravaStore.getState().checkConnection(user.id)

    if (window.location.pathname === STRAVA_CALLBACK_PATH) {
      const code = new URLSearchParams(window.location.search).get('code')
      window.history.replaceState({}, '', '/')
      if (code) {
        exchangeStravaCode(code)
          .then(({ athleteName }) => {
            useStravaStore.getState().applyCallback(athleteName)
            useUIStore.getState().showNotification('Strava connected', 'success')
          })
          .catch((e) => {
            useUIStore.getState().showNotification(e instanceof Error ? e.message : 'Could not connect Strava', 'error')
          })
      }
      setTab('sync')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const today = new Date()
  const todayStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // Client-side check is UX only (hides the tab for everyone else) — the
  // real gate is the server-side CHAT_OWNER_USER_ID allow-list every
  // /api/chat/* request is checked against.
  const showCoach = Boolean(user?.email && user.email === import.meta.env.VITE_CHAT_OWNER_EMAIL)

  // A bare empty div here used to be the first thing every cold start
  // showed — same branding as SignInScreen (minus the button) so there's
  // at least a visible, intentional-looking moment instead of a blank flash.
  if (authLoading) {
    return (
      <div className={styles.root} style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src="/icon.svg" width={48} height={48} style={{ borderRadius: '12px', opacity: 0.8 }} alt="" />
      </div>
    )
  }

  if (!user) {
    return <SignInScreen />
  }

  // Only block on a hard error screen when there's no usable profile at all
  // (brand-new session, first load failed). A transient error on an
  // already-established session keeps showing the last known-good profile —
  // see authStore's applyUser — so this won't fire for those.
  if (profileError && !profile) {
    return <ErrorScreen />
  }

  return (
    <div className={`${styles.root} ${timerActive ? styles.timerActive : ''}`}>
      <Header
        date={todayStr}
        streak={streak(sessions)}
        onLogoClick={() => { clearDraft(); setTab('today') }}
        userName={user.name}
        userAvatarUrl={user.avatarUrl}
        onAvatarClick={() => setTab('sync')}
      />

      <main className={styles.wrap}>
        {activeTab === 'today' && <TodayTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'trends' && <TrendsTab />}
        {activeTab === 'sync' && <SyncTab />}
        {activeTab === 'coach' && showCoach && (
          // Scoped to just this tab, not the top-level boundary in
          // main.tsx — a failure loading the lazy CoachTab chunk (a stale
          // service-worker cache after a deploy, a network blip) shouldn't
          // force reloading the whole app and losing whatever's on screen
          // elsewhere; it should just show an error in the Coach tab with
          // a way to retry loading it again.
          <ErrorBoundary
            fallback={(error, reset) => (
              <div style={{ padding: '24px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '13.5px', color: 'var(--dim)', marginBottom: '12px' }}>
                  Couldn't load the Coach tab. {error.message || ''}
                </div>
                <button
                  onClick={reset}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 'var(--r)',
                    background: 'var(--amber)',
                    color: 'var(--ink)',
                    fontWeight: 600,
                    fontSize: '13.5px',
                  }}
                >
                  Try again
                </button>
              </div>
            )}
          >
            <Suspense fallback={null}>
              <CoachTab />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>

      <RestTimer />
      <BottomNav activeTab={activeTab} onTabChange={setTab} showCoach={showCoach} />
      <Toast />
      <SpeedInsights />
    </div>
  )
}

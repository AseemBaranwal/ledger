import { useEffect } from 'react'
import { useConfigStore, useUIStore, useSessionStore, useAuthStore, useStravaStore } from '@/store'
import { Header, BottomNav, Toast } from '@/components/layout'
import { TodayTab, HistoryTab, TrendsTab, SyncTab, CoachTab } from '@/components/tabs'
import { RestTimer } from '@/components/session'
import { SignInScreen, OnboardingScreen, ErrorScreen } from '@/components/auth'
import { streak } from '@/services/trendCalculations'
import { restoreFromSheet } from '@/services/appScript'
import { unlockAudioContext } from '@/services/audio'
import { STRAVA_CALLBACK_PATH, exchangeStravaCode } from '@/services/strava'
import { registerSW } from 'virtual:pwa-register'
import type { Session } from '@/types'
import styles from '@/styles/App.module.css'

export default function App() {
  const activeTab = useUIStore((s) => s.activeTab)
  const setTab = useUIStore((s) => s.setTab)
  const loadConfig = useConfigStore((s) => s.loadConfig)
  const loadWeights = useConfigStore((s) => s.loadWeights)
  const sheetUrl = useConfigStore((s) => s.sheetUrl)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const sessions = useSessionStore((s) => s.sessions)
  const authLoading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const profileError = useAuthStore((s) => s.profileError)
  const authInit = useAuthStore((s) => s.init)

  // App-wide, auth-independent bootstrap: static program config, PWA
  // service worker, and the audio-unlock fallback. Runs once.
  useEffect(() => {
    loadConfig()

    const unsubscribeAuth = authInit()

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

  // Per-user bootstrap: once the signed-in user's sheet URL is known (set by
  // authStore from their profile), load their weight overrides, pull down
  // anything missing locally, and retry any sessions that failed to push.
  useEffect(() => {
    if (!sheetUrl) return

    loadWeights()

    const autoRestore = async () => {
      if (useSessionStore.getState().sessions.length > 0) return
      try {
        const data = await restoreFromSheet(sheetUrl)
        if (data.sessions && Array.isArray(data.sessions)) {
          const deduped: Record<string, Session> = {}
          data.sessions.forEach((s: Session) => {
            deduped[`${s.d}|${s.s}`] = s
          })
          const restored = Object.values(deduped).sort((a, b) => a.d.localeCompare(b.d))
          useSessionStore.setState({ sessions: restored })
        }
      } catch (e) {
        // silent — user can still restore manually from the Sync tab
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
  }, [sheetUrl])

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

  if (authLoading) {
    return <div className={styles.root} />
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

  if (!profile?.sheet_url) {
    return <OnboardingScreen />
  }

  return (
    <div className={styles.root}>
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
        {activeTab === 'coach' && showCoach && <CoachTab />}
      </main>

      <RestTimer />
      <BottomNav activeTab={activeTab} onTabChange={setTab} showCoach={showCoach} />
      <Toast />
    </div>
  )
}

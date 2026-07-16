import { useEffect } from 'react'
import { useConfigStore, useUIStore, useSessionStore } from '@/store'
import { Header, BottomNav, Toast } from '@/components/layout'
import { TodayTab, HistoryTab, TrendsTab, SyncTab } from '@/components/tabs'
import { RestTimer } from '@/components/session'
import { streak } from '@/services/trendCalculations'
import { restoreFromSheet } from '@/services/appScript'
import { unlockAudioContext } from '@/services/audio'
import { registerSW } from 'virtual:pwa-register'
import type { Session } from '@/types'
import styles from '@/styles/App.module.css'

export default function App() {
  const activeTab = useUIStore((s) => s.activeTab)
  const setTab = useUIStore((s) => s.setTab)
  const loadConfig = useConfigStore((s) => s.loadConfig)
  const loadWeights = useConfigStore((s) => s.loadWeights)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const sessions = useSessionStore((s) => s.sessions)

  useEffect(() => {
    // Initialize config and weights
    loadConfig()
    loadWeights()

    // On a fresh browser/device with no local sessions yet, pull whatever's
    // already in the sheet instead of showing an empty log.
    const autoRestore = async () => {
      if (useSessionStore.getState().sessions.length > 0) return
      const sheetUrl = useConfigStore.getState().sheetUrl
      if (!sheetUrl) return
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

    // Retry any sessions that failed to push earlier (e.g. the phone was offline)
    useSessionStore.getState().flushPendingSync()
    const onOnline = () => useSessionStore.getState().flushPendingSync()
    window.addEventListener('online', onOnline)

    // Unlock Web Audio on the first tap anywhere, as a fallback for flows
    // that don't go through the exercise-logger tap handler.
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
      window.removeEventListener('online', onOnline)
      document.removeEventListener('pointerdown', unlock)
    }
  }, [loadConfig, loadWeights])

  const today = new Date()
  const todayStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className={styles.root}>
      <Header date={todayStr} streak={streak(sessions)} onLogoClick={() => { clearDraft(); setTab('today') }} />

      <main className={styles.wrap}>
        {activeTab === 'today' && <TodayTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'trends' && <TrendsTab />}
        {activeTab === 'sync' && <SyncTab />}
      </main>

      <RestTimer />
      <BottomNav activeTab={activeTab} onTabChange={setTab} />
      <Toast />
    </div>
  )
}

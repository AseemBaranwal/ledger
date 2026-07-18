import { useState } from 'react'
import { useConfigStore, useSessionStore, useUIStore, useAuthStore, useStravaStore } from '@/store'
import { restoreFromSheet, pushSession } from '@/services/appScript'
import { stravaConfigured } from '@/services/strava'
import { Avatar } from '@/components/layout'
import { ChevronIcon } from '@/components/icons/Icons'
import type { Session } from '@/types'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

const dedupKey = (s: Session) => `${s.d}|${s.s}`

function timeAgo(ms: number | null): string {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export function SyncTab() {
  const sheetUrl = useConfigStore((s) => s.sheetUrl)
  const loadWeights = useConfigStore((s) => s.loadWeights)
  const showNotification = useUIStore((s) => s.showNotification)
  const sessions = useSessionStore((s) => s.sessions)
  const pendingSync = useSessionStore((s) => s.pendingSync)
  const lastSyncedAt = useSessionStore((s) => s.lastSyncedAt)
  const flushPendingSync = useSessionStore((s) => s.flushPendingSync)
  const markSynced = useSessionStore((s) => s.markSynced)

  const user = useAuthStore((s) => s.user)
  const saveSheetUrl = useAuthStore((s) => s.saveSheetUrl)
  const savingUrl = useAuthStore((s) => s.savingUrl)
  const signOut = useAuthStore((s) => s.signOut)

  const stravaConnected = useStravaStore((s) => s.connected)
  const stravaAthleteName = useStravaStore((s) => s.athleteName)
  const stravaDisconnecting = useStravaStore((s) => s.disconnecting)
  const connectStrava = useStravaStore((s) => s.connect)
  const disconnectStravaAction = useStravaStore((s) => s.disconnect)

  const [url, setUrl] = useState(sheetUrl)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  const connected = Boolean(sheetUrl)
  const urlDirty = url !== sheetUrl

  const handleSaveUrl = async () => {
    setUrlError(null)
    try {
      await saveSheetUrl(url)
      showNotification('Sheet URL saved', 'success')
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : 'Could not save that URL — try again')
    }
  }

  // Full reconciliation: whatever's only in the sheet gets pulled in, whatever's
  // only local (e.g. logged on this device while offline, or the push silently
  // failed) gets pushed up. Nothing is ever deleted or overwritten on either
  // side — this only ever adds records, so it's safe to run any time.
  const handleSyncNow = async () => {
    if (!sheetUrl) {
      showNotification('Sheet URL not configured', 'error')
      return
    }

    setSyncing(true)
    try {
      const data = await restoreFromSheet(sheetUrl)
      const remoteSessions: Session[] = Array.isArray(data.sessions) ? data.sessions : []
      const remoteKeys = new Set(remoteSessions.map(dedupKey))

      const localSessions = useSessionStore.getState().sessions
      const localKeys = new Set(localSessions.map(dedupKey))

      // REST-day sessions were never synced in the first place — only push
      // PROGRAM sessions, matching what saveDraft() does automatically.
      const toPush = localSessions.filter((s) => s.type !== 'REST' && s.s && !remoteKeys.has(dedupKey(s)))
      let pushed = 0
      for (const s of toPush) {
        try {
          await pushSession(sheetUrl, s)
          pushed++
        } catch (e) {
          // leave it — it'll get picked up by the automatic retry or the next manual sync
        }
      }

      const toPull = remoteSessions.filter((s) => !localKeys.has(dedupKey(s)))
      if (toPull.length) {
        useSessionStore.setState((state) => ({
          sessions: [...state.sessions, ...toPull].sort((a, b) => a.d.localeCompare(b.d)),
        }))
      }

      markSynced()
      showNotification(`Synced — pushed ${pushed}, pulled ${toPull.length}`, 'success')
    } catch (error) {
      showNotification('Sync failed: ' + (error as Error).message, 'error')
    } finally {
      setSyncing(false)
    }
  }

  // Pull-only, but merges rather than overwrites: anything local that isn't
  // in the sheet yet (e.g. a session that failed to push) is kept, not wiped.
  const handleRestore = async () => {
    if (!sheetUrl) {
      showNotification('Sheet URL not configured', 'error')
      return
    }

    setLoading(true)
    try {
      const data = await restoreFromSheet(sheetUrl)
      const remoteSessions: Session[] = Array.isArray(data.sessions) ? data.sessions : []
      const localKeys = new Set(useSessionStore.getState().sessions.map(dedupKey))
      const toPull = remoteSessions.filter((s) => !localKeys.has(dedupKey(s)))

      if (toPull.length) {
        useSessionStore.setState((state) => ({
          sessions: [...state.sessions, ...toPull].sort((a, b) => a.d.localeCompare(b.d)),
        }))
      }
      showNotification(`Restored ${toPull.length} new session${toPull.length === 1 ? '' : 's'}`, 'success')
    } catch (error) {
      showNotification('Failed to restore from sheet', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectStrava = async () => {
    try {
      await disconnectStravaAction()
      showNotification('Strava disconnected', 'success')
    } catch (error) {
      showNotification('Failed to disconnect Strava', 'error')
    }
  }

  const handleLoadWeights = async () => {
    setLoading(true)
    try {
      await loadWeights()
      showNotification('Weights updated', 'success')
    } catch (error) {
      showNotification('Failed to load weights', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadBackup = () => {
    const data = { sessions, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const today = new Date().toISOString().split('T')[0]
    a.download = `ledger-backup-${today}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    showNotification('Backup downloaded', 'success')
  }

  const handleRestoreFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const fileSessions: Session[] = Array.isArray(parsed.sessions) ? parsed.sessions : []
        const localKeys = new Set(useSessionStore.getState().sessions.map(dedupKey))
        const toAdd = fileSessions.filter((s) => !localKeys.has(dedupKey(s)))
        if (toAdd.length) {
          useSessionStore.setState((state) => ({
            sessions: [...state.sessions, ...toAdd].sort((a, b) => a.d.localeCompare(b.d)),
          }))
        }
        showNotification(`Restored ${toAdd.length} session${toAdd.length === 1 ? '' : 's'} from file`, 'success')
      } catch (e) {
        showNotification('That file is not a valid Ledger backup', 'error')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Hand the data over</div>
        <h1>Sync</h1>
        {user && (
          <div className={appStyles.heroSub} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
            <Avatar name={user.name} avatarUrl={user.avatarUrl} />
            <span>{user.name ? `${user.name} · ${user.email}` : user.email}</span>
            <button
              onClick={signOut}
              style={{ fontSize: '11px', color: 'var(--dim)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Status card */}
      <div className={styles.card} style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connected ? 'var(--teal)' : 'var(--coral)',
              flex: 'none',
            }}
          />
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            {connected ? 'Connected to sheet' : 'No sheet configured'}
          </span>
        </div>
        <div className={styles.statGrid} style={{ marginBottom: 0 }}>
          <div className={styles.stat}>
            <div className={styles.l}>Local sessions</div>
            <div className={`${styles.v} mono`}>{sessions.length}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.l}>Pending sync</div>
            <div className={`${styles.v} mono`} style={{ color: pendingSync.length ? 'var(--coral)' : 'var(--teal)' }}>
              {pendingSync.length}
            </div>
            <div className={`${styles.d} mono`}>
              {pendingSync.length ? 'will retry automatically' : 'all caught up'}
            </div>
          </div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--dim)', marginTop: '10px', fontFamily: 'JetBrains Mono' }}>
          Last synced: {timeAgo(lastSyncedAt)}
        </div>
      </div>

      {/* Primary action */}
      <div style={{ marginTop: '16px' }}>
        <button
          className={`${styles.btn} ${styles.primary}`}
          onClick={handleSyncNow}
          disabled={syncing || !connected}
        >
          {syncing ? 'Syncing…' : 'Sync Now — Pull + Push'}
        </button>
        <div className={styles.note} style={{ marginTop: '8px', marginBottom: 0 }}>
          Compares what's in the sheet against what's on this device, pulls down anything missing locally, and
          pushes up anything the sheet doesn't have yet. Never deletes or overwrites — only adds.
        </div>
        {pendingSync.length > 0 && (
          <button
            className={`${styles.btn} ${styles.quiet}`}
            style={{ marginTop: '8px' }}
            onClick={() => {
              flushPendingSync()
              showNotification('Retrying pending sessions…', 'info')
            }}
          >
            Retry {pendingSync.length} pending now
          </button>
        )}
      </div>

      {/* Strava */}
      <div className={styles.sec}>
        <h2>Strava</h2>
        <div className={styles.rule} />
      </div>
      {stravaConnected ? (
        <>
          <div className={styles.note}>
            Connected as {stravaAthleteName || 'your Strava account'}. New weight-training sessions post there
            automatically.
          </div>
          <button
            className={`${styles.btn} ${styles.ghost}`}
            onClick={handleDisconnectStrava}
            disabled={stravaDisconnecting}
          >
            {stravaDisconnecting ? 'Disconnecting…' : 'Disconnect Strava'}
          </button>
        </>
      ) : (
        <>
          <div className={styles.note}>
            Automatically post your lifting sessions to Strava as activities, in addition to the Sheet.
          </div>
          <button className={`${styles.btn} ${styles.ghost}`} onClick={connectStrava} disabled={!stravaConfigured}>
            Connect Strava
          </button>
          {!stravaConfigured && <div className={styles.warn}>Strava isn't configured yet.</div>}
        </>
      )}

      {/* Advanced */}
      <div className={styles.sec} style={{ cursor: 'pointer' }} onClick={() => setAdvancedOpen(!advancedOpen)}>
        <h2>Advanced</h2>
        <div className={styles.rule} />
        <span style={{ fontSize: '11px', color: 'var(--dim)' }}>
          <ChevronIcon open={advancedOpen} />
        </span>
      </div>

      {advancedOpen && (
        <div>
          <div className={styles.field}>
            <label>Apps Script URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setUrlError(null) }}
              placeholder="https://script.google.com/macros/s/..."
              style={{ fontSize: '12px' }}
            />
          </div>
          {urlError && <div className={styles.warn}>{urlError}</div>}
          <button
            className={`${styles.btn} ${styles.ghost}`}
            onClick={handleSaveUrl}
            disabled={!urlDirty || savingUrl}
            style={{ marginBottom: '20px' }}
          >
            {savingUrl ? 'Saving…' : urlDirty ? 'Save URL' : 'URL saved'}
          </button>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button className={`${styles.btn} ${styles.ghost}`} onClick={handleRestore} disabled={loading || !connected}>
              {loading ? 'Working…' : 'Restore from Sheet'}
            </button>
            <button className={`${styles.btn} ${styles.ghost}`} onClick={handleLoadWeights} disabled={loading || !connected}>
              {loading ? 'Working…' : 'Load Weights'}
            </button>
          </div>

          <div className={styles.sec}>
            <h2>Local backup</h2>
            <div className={styles.rule} />
          </div>
          <div className={styles.note}>Download a copy of everything on this device, or restore from a file.</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`${styles.btn} ${styles.ghost}`} onClick={handleDownloadBackup}>
              Download
            </button>
            <button
              className={`${styles.btn} ${styles.ghost}`}
              onClick={() => document.getElementById('backup-file-input')?.click()}
            >
              Restore from file
            </button>
          </div>
          <input
            id="backup-file-input"
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleRestoreFile(file)
              e.target.value = ''
            }}
          />
        </div>
      )}

      <div className={styles.note} style={{ marginTop: '24px' }}>
        💡 <b>Sync:</b> Sessions push to the sheet automatically when you finish logging. Sync Now is there for when
        a session was logged offline, on another device, or a push silently failed.
      </div>
      <div style={{ height: '20px' }} />
    </div>
  )
}

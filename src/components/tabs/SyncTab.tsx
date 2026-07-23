import { useSessionStore, useUIStore, useAuthStore, useStravaStore } from '@/store'
import { stravaConfigured } from '@/services/strava'
import { Avatar } from '@/components/layout'
import type { Session } from '@/types'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

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
  const showNotification = useUIStore((s) => s.showNotification)
  const sessions = useSessionStore((s) => s.sessions)
  const pendingSync = useSessionStore((s) => s.pendingSync)
  const lastSyncedAt = useSessionStore((s) => s.lastSyncedAt)
  const flushPendingSync = useSessionStore((s) => s.flushPendingSync)

  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)

  const stravaConnected = useStravaStore((s) => s.connected)
  const stravaAthleteName = useStravaStore((s) => s.athleteName)
  const stravaDisconnecting = useStravaStore((s) => s.disconnecting)
  const connectStrava = useStravaStore((s) => s.connect)
  const disconnectStravaAction = useStravaStore((s) => s.disconnect)

  const dedupKey = (s: Session) => `${s.d}|${s.s}`

  const handleDisconnectStrava = async () => {
    try {
      await disconnectStravaAction()
      showNotification('Strava disconnected', 'success')
    } catch (error) {
      showNotification('Failed to disconnect Strava', 'error')
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
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--teal)', flex: 'none' }} />
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Synced to your account</span>
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
          Last saved: {timeAgo(lastSyncedAt)}
        </div>
        {pendingSync.length > 0 && (
          <button
            className={`${styles.btn} ${styles.quiet}`}
            style={{ marginTop: '10px' }}
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
            Automatically post your lifting sessions to Strava as activities.
          </div>
          <button className={`${styles.btn} ${styles.ghost}`} onClick={connectStrava} disabled={!stravaConfigured}>
            Connect Strava
          </button>
          {!stravaConfigured && <div className={styles.warn}>Strava isn't configured yet.</div>}
        </>
      )}

      {/* Local backup */}
      <div className={styles.sec}>
        <h2>Local backup</h2>
        <div className={styles.rule} />
      </div>
      <div className={styles.note}>Download a copy of everything on this device, or restore from a file.</div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
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

      <div className={styles.note} style={{ marginTop: '24px' }}>
        💡 <b>Sync:</b> Sessions save to your account automatically when you finish logging — no setup needed. This
        tab is for Strava and local backups.
      </div>
      <div style={{ height: '20px' }} />
    </div>
  )
}

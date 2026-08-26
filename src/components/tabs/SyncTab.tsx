import { useState, type ReactNode } from 'react'
import { useSessionStore, useUIStore, useAuthStore, useStravaStore, useGoogleHealthStore, useUnitStore } from '@/store'
import { stravaConfigured } from '@/services/strava'
import { googleHealthConfigured } from '@/services/googleHealth'
import { sheetSyncConfigured, syncSessionsToSheet } from '@/services/sheetSync'
import { Avatar } from '@/components/layout'
import { StravaMark, GoogleHealthMark } from '@/components/icons/BrandIcons'
import { SpinnerIcon } from '@/components/icons/Icons'
import type { UnitSystem } from '@/services/units'
import type { Session } from '@/types'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

const STRAVA_ORANGE = '#FC4C02'
const GOOGLE_BLUE = '#4285F4'

type ConnState = 'off' | 'on' | 'warn' | 'busy'

// A pill-shaped chip per third-party connection, sized to its content so
// several sit side by side on one line. The icon badge alone carries the
// entire status signal — a hollow muted outline when disconnected, filled
// solid with the service's own brand color once linked — rather than a
// checkmark, trailing label, or a second button. One tap does the whole
// job: connect when off, disconnect when on, reconnect when Google's
// weekly token expiry (see the Google Health block below) needs it.
function ConnectionChip({
  brandIcon,
  brandColor,
  label,
  state,
  onPress,
  disabled,
}: {
  brandIcon: ReactNode
  brandColor: string
  label: string
  state: ConnState
  onPress: () => void
  disabled?: boolean
}) {
  const busy = state === 'busy'
  const badgeBg = state === 'on' ? brandColor : state === 'warn' ? 'var(--amber)' : 'transparent'
  const badgeColor = state === 'on' ? '#fff' : state === 'warn' ? 'var(--ink)' : 'var(--dim)'

  return (
    <button
      className={`${styles.chip} ${state === 'on' ? styles.chipOn : ''} ${state === 'warn' ? styles.chipWarn : ''}`}
      onClick={onPress}
      disabled={disabled || busy}
      aria-label={state === 'off' ? `Connect ${label}` : state === 'warn' ? `Reconnect ${label}` : `Disconnect ${label}`}
      aria-pressed={state === 'on' || state === 'warn'}
    >
      <span className={styles.chipBadge} style={{ background: badgeBg, color: badgeColor }}>
        {busy ? <SpinnerIcon size="14px" className={styles.spin} /> : brandIcon}
      </span>
      <span className={styles.chipLabel}>{label}</span>
    </button>
  )
}

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

  // Gates Local Backup and (when enabled) the Google Sheet power-user
  // override — both are low-frequency actions that don't need permanent
  // top-level real estate.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sheetSyncing, setSheetSyncing] = useState(false)

  const unitSystem = useUnitStore((s) => s.unitSystem) ?? 'imperial'
  const setUnitSystem = useUnitStore((s) => s.setUnitSystem)

  const stravaConnected = useStravaStore((s) => s.connected)
  const stravaChecking = useStravaStore((s) => s.checking)
  const stravaDisconnecting = useStravaStore((s) => s.disconnecting)
  const connectStrava = useStravaStore((s) => s.connect)
  const disconnectStravaAction = useStravaStore((s) => s.disconnect)

  const googleHealthConnected = useGoogleHealthStore((s) => s.connected)
  const googleHealthNeedsReconnect = useGoogleHealthStore((s) => s.needsReconnect)
  const googleHealthDisconnecting = useGoogleHealthStore((s) => s.disconnecting)
  const connectGoogleHealth = useGoogleHealthStore((s) => s.connect)
  const disconnectGoogleHealthAction = useGoogleHealthStore((s) => s.disconnect)

  const dedupKey = (s: Session) => `${s.d}|${s.s}`

  // lastSyncedAt only ever gets set by a successful save from THIS device
  // session — on a fresh load (or a different device) it's always null,
  // even when the account clearly has synced history, which is exactly
  // what made this read "Last saved: never" for an account with 10 synced
  // sessions and "all caught up" showing right above it. Falling back to
  // the most recent local session's own date means this always reflects
  // reality instead of only ever being accurate mid-way through the one
  // session that happened to save something.
  const lastActivityMs = lastSyncedAt ?? (sessions.length ? new Date(sessions[sessions.length - 1].d + 'T12:00').getTime() : null)

  const handleSheetSync = async () => {
    setSheetSyncing(true)
    try {
      const result = await syncSessionsToSheet()
      if (!result.success) {
        showNotification(result.error || 'Sheet sync failed', 'error')
      } else if (result.exported === 0 && !result.weightExported && !result.recoveryExported) {
        showNotification('Sheet already up to date', 'info')
      } else {
        const parts: string[] = []
        if (result.exported) parts.push(`${result.exported} session${result.exported === 1 ? '' : 's'}`)
        if (result.weightExported) parts.push(`${result.weightExported} weight reading${result.weightExported === 1 ? '' : 's'}`)
        if (result.recoveryExported) parts.push(`${result.recoveryExported} recovery reading${result.recoveryExported === 1 ? '' : 's'}`)
        const totalFailures = result.failures + (result.weightFailures || 0) + (result.recoveryFailures || 0)
        const suffix = totalFailures ? ` (${totalFailures} failed)` : ''
        showNotification(`Synced ${parts.join(' and ')} to Sheet${suffix}`, totalFailures ? 'error' : 'success')
      }
    } catch {
      showNotification('Sheet sync failed', 'error')
    } finally {
      setSheetSyncing(false)
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

  const handleDisconnectGoogleHealth = async () => {
    try {
      await disconnectGoogleHealthAction()
      showNotification('Google Health disconnected', 'success')
    } catch (error) {
      showNotification('Failed to disconnect Google Health', 'error')
    }
  }

  // The chip is a single toggle: connect when off, disconnect when
  // healthy-connected, reconnect when Google's weekly token expiry (see
  // the needs-reconnect note below) has left it in the amber state.
  const handleStravaChipPress = () => {
    if (stravaConnected) handleDisconnectStrava()
    else connectStrava()
  }

  const handleGoogleHealthChipPress = () => {
    if (googleHealthConnected && !googleHealthNeedsReconnect) handleDisconnectGoogleHealth()
    else connectGoogleHealth()
  }

  const handleDownloadBackup = () => {
    const data = { sessions, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const today = new Date().toISOString().split('T')[0]
    a.download = `ledger-backup-${today}.json`
    a.click()
    // Deferred, not revoked on the very next line — some browsers/PWA
    // contexts (notably iOS Safari standalone) can race an immediate
    // revoke against the download actually starting, producing an
    // empty/failed file with no visible error.
    setTimeout(() => URL.revokeObjectURL(a.href), 0)
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
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: pendingSync.length ? 'var(--coral)' : 'var(--teal)', flex: 'none' }} />
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            {pendingSync.length ? `${pendingSync.length} session${pendingSync.length === 1 ? '' : 's'} pending sync` : 'Synced to your account'}
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
          Last activity: {timeAgo(lastActivityMs)}
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

      {/* Connections — both chips share one line (issue #61 grouped these
          under one section; this pass condenses each from a heading +
          paragraph + full-width button down to a pill: brand icon + name,
          status conveyed only by the badge's own color). */}
      <div className={styles.sec}>
        <h2>Connections</h2>
        <div className={styles.rule} />
      </div>

      <div className={styles.connRow}>
        <ConnectionChip
          brandIcon={<StravaMark size="16px" />}
          brandColor={STRAVA_ORANGE}
          label="Strava"
          state={stravaChecking || stravaDisconnecting ? 'busy' : stravaConnected ? 'on' : 'off'}
          onPress={handleStravaChipPress}
          disabled={!stravaConfigured}
        />
        {/* Google Health has three states, not two — while this app's
            consent screen sits in "Testing" status, Google force-expires
            the refresh token every 7 days, so "connected but needs
            reauthorizing" is routine, not a failure. The badge goes amber
            for that state (matching the app's own accent, not the red
            .warn box) and a one-line note stays below, since that's the
            one case where color alone doesn't say what to do or why —
            every other state needs none. */}
        <ConnectionChip
          brandIcon={<GoogleHealthMark size="16px" />}
          brandColor={GOOGLE_BLUE}
          label="Google Health"
          state={googleHealthDisconnecting ? 'busy' : googleHealthNeedsReconnect ? 'warn' : googleHealthConnected ? 'on' : 'off'}
          onPress={handleGoogleHealthChipPress}
          disabled={!googleHealthConfigured}
        />
      </div>
      {!stravaConfigured && <div className={styles.warn}>Strava isn't configured yet.</div>}
      {googleHealthNeedsReconnect && (
        <div className={styles.note}>
          Google expires access weekly while its consent screen is in testing — reconnect to keep recovery data
          reaching the Coach.
        </div>
      )}
      {!googleHealthConfigured && <div className={styles.warn}>Google Health isn't configured yet.</div>}

      {/* Units — defaults from the browser's locale on first sign-in
          (e.g. en-US -> lb, en-IN -> kg) but never overwrites an explicit
          choice made here afterward, even if the device's own locale
          changes later (e.g. traveling). Weight is still stored/computed
          in lb everywhere internally; this only changes what's shown and
          what the stepper accepts as input. */}
      <div className={styles.sec}>
        <h2>Units</h2>
        <div className={styles.rule} />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['imperial', 'metric'] as UnitSystem[]).map((sys) => (
          <button
            key={sys}
            className={`${styles.btn} ${unitSystem === sys ? styles.primary : styles.ghost}`}
            onClick={() => setUnitSystem(sys)}
          >
            {sys === 'imperial' ? 'Pounds (lb)' : 'Kilograms (kg)'}
          </button>
        ))}
      </div>

      {/* Advanced — low-frequency actions that don't need permanent
          top-level space: local backup/restore always lives here, and the
          owner's own Google Sheet power-user override (a manual trigger
          for a script that otherwise runs from the terminal; most accounts
          never see it at all — sheetSyncConfigured is a build-time flag,
          off unless VITE_SHEET_SYNC_ENABLED is set) joins it when enabled. */}
      <button
        className={`${styles.btn} ${styles.quiet}`}
        style={{ marginTop: '24px' }}
        onClick={() => setAdvancedOpen((o) => !o)}
      >
        {advancedOpen ? 'Hide advanced' : 'Show advanced'}
      </button>
      {advancedOpen && (
        <>
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

          {sheetSyncConfigured && (
            <>
              <div className={styles.sec}>
                <h2>Google Sheet</h2>
                <div className={styles.rule} />
              </div>
              <div className={styles.note}>Push newly-logged sessions into your Ledger Log sheet.</div>
              <button className={`${styles.btn} ${styles.ghost}`} onClick={handleSheetSync} disabled={sheetSyncing}>
                {sheetSyncing ? 'Syncing…' : 'Sync to Sheet'}
              </button>
            </>
          )}
        </>
      )}

      <div className={styles.note} style={{ marginTop: '24px' }}>
        💡 <b>Sync:</b> Sessions save to your account automatically when you finish logging — no setup needed. This
        tab is for connections and advanced/backup options.
      </div>
      <div style={{ height: '20px' }} />
    </div>
  )
}

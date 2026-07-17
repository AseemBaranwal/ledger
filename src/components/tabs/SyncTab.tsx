import { useState } from 'react'
import { useConfigStore, useSessionStore, useUIStore } from '@/store'
import { restoreFromSheet, pushSession } from '@/services/appScript'
import type { Session } from '@/types'
import styles from '../../styles/components.module.css'

const dedupKey = (s: Session) => `${s.d}|${s.s}`

export function SyncTab() {
  const sheetUrl = useConfigStore((s) => s.sheetUrl)
  const updateSheetUrl = useConfigStore((s) => s.updateSheetUrl)
  const loadWeights = useConfigStore((s) => s.loadWeights)
  const showNotification = useUIStore((s) => s.showNotification)
  const [url, setUrl] = useState(sheetUrl)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const handleSaveUrl = () => {
    updateSheetUrl(url)
    showNotification('Sheet URL saved', 'success')
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

      showNotification(`Synced — pushed ${pushed}, pulled ${toPull.length}`, 'success')
    } catch (error) {
      showNotification('Sync failed: ' + (error as Error).message, 'error')
    } finally {
      setSyncing(false)
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

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '16px' }}>Sync & Backup</h2>

      <div className={styles.field}>
        <label>Apps Script URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://script.google.com/macros/d/..."
          style={{ fontSize: '12px' }}
        />
      </div>

      <button className={styles.btn} style={{ background: 'var(--amber)', color: '#14181D' }} onClick={handleSaveUrl}>
        Save URL
      </button>

      <div style={{ marginTop: '20px' }}>
        <h3 style={{ fontSize: '13px', marginBottom: '10px' }}>Sync Now</h3>
        <button
          className={styles.btn}
          style={{ background: 'var(--amber)', color: '#14181D' }}
          onClick={handleSyncNow}
          disabled={syncing}
        >
          {syncing ? 'Syncing…' : 'Pull + Push'}
        </button>
        <div className={styles.note} style={{ marginTop: '8px' }}>
          Compares what's in the sheet against what's on this device, pulls down anything missing locally, and
          pushes up anything the sheet doesn't have yet. Never deletes or overwrites — only adds.
        </div>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3 style={{ fontSize: '13px', marginBottom: '10px' }}>Restore</h3>
        <button
          className={styles.btn}
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          onClick={handleRestore}
          disabled={loading}
        >
          {loading ? 'Restoring...' : 'Restore from Sheet'}
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3 style={{ fontSize: '13px', marginBottom: '10px' }}>Weights</h3>
        <button
          className={styles.btn}
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          onClick={handleLoadWeights}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load Weights from Sheet'}
        </button>
      </div>

      <div className={styles.note} style={{ marginTop: '20px' }}>
        💡 <b>Sync:</b> Sessions auto-save to sheet when you finish logging. Use Sync Now if a session was logged
        offline or on another device and hasn't shown up yet.
      </div>
    </div>
  )
}

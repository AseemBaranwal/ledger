import { useState } from 'react'
import { useConfigStore, useSessionStore, useUIStore } from '@/store'
import styles from '../../styles/components.module.css'

export function SyncTab() {
  const sheetUrl = useConfigStore((s) => s.sheetUrl)
  const updateSheetUrl = useConfigStore((s) => s.updateSheetUrl)
  const loadWeights = useConfigStore((s) => s.loadWeights)
  const showNotification = useUIStore((s) => s.showNotification)
  const [url, setUrl] = useState(sheetUrl)
  const [loading, setLoading] = useState(false)

  const handleSaveUrl = () => {
    updateSheetUrl(url)
    showNotification('Sheet URL saved', 'success')
  }

  const handleRestore = async () => {
    if (!sheetUrl) {
      showNotification('Sheet URL not configured', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${sheetUrl}?action=export`)
      const data = await response.json()

      if (data.sessions) {
        useSessionStore.setState({ sessions: data.sessions })
        showNotification(`Restored ${data.sessions.length} sessions`, 'success')
      }
    } catch (error) {
      showNotification('Failed to restore from sheet', 'error')
    } finally {
      setLoading(false)
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
        💡 <b>Sync:</b> Sessions auto-save to sheet when you finish logging. Use Restore to recover data if localStorage is cleared.
      </div>
    </div>
  )
}

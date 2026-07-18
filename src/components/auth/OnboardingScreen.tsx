import { useState } from 'react'
import { useAuthStore, useUIStore } from '@/store'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

export function OnboardingScreen() {
  const user = useAuthStore((s) => s.user)
  const savingUrl = useAuthStore((s) => s.savingUrl)
  const saveSheetUrl = useAuthStore((s) => s.saveSheetUrl)
  const signOut = useAuthStore((s) => s.signOut)
  const showNotification = useUIStore((s) => s.showNotification)
  const [url, setUrl] = useState('')

  const handleConnect = async () => {
    if (!url.trim()) return
    try {
      await saveSheetUrl(url.trim())
      showNotification('Sheet connected', 'success')
    } catch (e) {
      showNotification('Could not save that URL — try again', 'error')
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px' }}>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Welcome, {user?.email}</div>
        <h1>Connect your Sheet</h1>
        <div className={appStyles.heroSub}>
          Paste the Apps Script Web App URL for your training log. If you haven't set one up yet, follow the
          instructions at the top of <code className="mono">apps-script.gs</code> in the repo — five minutes, once.
        </div>
      </div>

      <div className={styles.field}>
        <label>Apps Script URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/..."
          style={{ fontSize: '12px' }}
        />
      </div>

      <button
        className={`${styles.btn} ${styles.primary}`}
        disabled={!url.trim() || savingUrl}
        onClick={handleConnect}
      >
        {savingUrl ? 'Connecting…' : 'Connect'}
      </button>

      <button className={`${styles.btn} ${styles.quiet}`} style={{ marginTop: '10px' }} onClick={signOut}>
        Sign out
      </button>
    </div>
  )
}

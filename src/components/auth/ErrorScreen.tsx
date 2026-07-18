import { useAuthStore } from '@/store'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

export function ErrorScreen() {
  const profileError = useAuthStore((s) => s.profileError)
  const retryProfileLoad = useAuthStore((s) => s.retryProfileLoad)
  const signOut = useAuthStore((s) => s.signOut)

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px' }}>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Something went wrong</div>
        <h1>Couldn't load your profile</h1>
        <div className={appStyles.heroSub}>{profileError || 'Unknown error'}</div>
      </div>

      <div className={styles.warn}>
        This is a connection problem, not a sign-out — your account and sheet connection are still intact. Try
        again in a moment.
      </div>

      <button className={`${styles.btn} ${styles.primary}`} onClick={retryProfileLoad}>
        Try again
      </button>
      <button className={`${styles.btn} ${styles.quiet}`} style={{ marginTop: '10px' }} onClick={signOut}>
        Sign out
      </button>
    </div>
  )
}

import appStyles from '../styles/App.module.css'
import styles from '../styles/components.module.css'

// Full-app fallback for the top-level ErrorBoundary — deliberately just a
// reload button, not a "try again" reset(): a render crash at this level
// means something in the whole tree is broken, not one component, so
// clearing the boundary and re-rendering the same broken tree would very
// likely just crash again immediately.
export function CrashScreen({ error }: { error: Error }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px' }}>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Something went wrong</div>
        <h1>The app hit an error</h1>
        <div className={appStyles.heroSub}>
          Nothing you've already logged is affected — your saved sessions live in your account, not this screen.
        </div>
      </div>

      <div className={styles.warn}>{error.message || 'Unknown error'}</div>

      <button className={`${styles.btn} ${styles.primary}`} onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}

import { useAuthStore } from '@/store'
import { supabaseConfigured } from '@/services/supabaseClient'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flex: 'none' }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

export function SignInScreen() {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <img src="/icon.svg" width={64} height={64} style={{ borderRadius: '16px', marginBottom: '20px' }} alt="" />
      <div className={appStyles.brand} style={{ fontSize: '28px', marginBottom: '10px' }}>
        LED<em>G</em>ER
      </div>
      <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '32px', maxWidth: '280px', lineHeight: 1.5 }}>
        Your training log, wherever you sign in.
      </p>
      <button
        className={`${styles.btn} ${styles.primary}`}
        style={{ maxWidth: '280px', gap: '10px' }}
        onClick={signInWithGoogle}
        disabled={!supabaseConfigured}
      >
        <GoogleIcon />
        Sign in with Google
      </button>
      {!supabaseConfigured && (
        <p style={{ color: 'var(--coral)', fontSize: '12px', marginTop: '16px', maxWidth: '280px' }}>
          Sign-in isn't configured yet — VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY need to be set.
        </p>
      )}
    </div>
  )
}

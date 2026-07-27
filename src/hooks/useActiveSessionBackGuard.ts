import { useEffect } from 'react'
import { useSessionStore } from '@/store'

// Traps the phone/browser back button while a workout is actively being
// logged. The app has no client-side routing at all — tabs are just
// in-memory state (see App.tsx) — and sign-in does a real full-page
// redirect to Google's OAuth page and back (authStore.ts), which is the
// only thing that ever pushes browser history here. With nothing else in
// that history, the very first back tap anywhere in the app — including
// mid-workout — lands back in that Google auth redirect chain instead of
// doing something sane inside the app.
//
// Pushing one history entry the moment a draft session starts, and
// re-pushing on every popstate while it's still active, absorbs the back
// button instead of letting it navigate away. This intentionally does NOT
// try to clean up that extra entry when the session ends — the first back
// tap afterward just lands on it without visibly changing anything (same
// URL), and the next one continues normally. Discarding/finishing a
// session already has its own explicit in-app control (the "Discard this
// session?" confirm in TodayTab), so silently absorbing back here can't
// strand anyone who actually wants to leave.
export function useActiveSessionBackGuard() {
  const draft = useSessionStore((s) => s.draft)

  useEffect(() => {
    if (!draft) return

    window.history.pushState({ ledgerActiveSession: true }, '')

    const onPopState = () => {
      if (useSessionStore.getState().draft) {
        window.history.pushState({ ledgerActiveSession: true }, '')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [draft])
}

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/services/errorReporting'

interface ErrorBoundaryProps {
  children: ReactNode
  // Rendered in place of the crashed subtree. Receives the error so a
  // caller can show something specific to what broke, and a reset()
  // callback that clears the boundary's own state — useful for a scoped
  // boundary (e.g. one tab) where the fix is "try rendering again," not
  // "reload the whole app."
  fallback: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

// React only supports catching render-phase errors via a class component —
// there's no hook equivalent. This was previously missing entirely (issue
// #58): any uncaught render exception anywhere — a malformed session
// shape, a lazy-chunk load failure, any component throwing — blanked the
// ENTIRE app to a white screen with zero recovery path except a hard
// reload, which is itself what could trigger the cold-start draft-wipe bug
// fixed alongside this. A visible, recoverable error screen is strictly
// better than a silent blank one either way.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Render-phase errors never reach window.onerror/unhandledrejection
    // (see main.tsx) — this is the only place they're ever caught at all.
    console.error('[ErrorBoundary] caught a render error:', error, info.componentStack)
    reportClientError(error.message, error.stack, 'error_boundary')
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}

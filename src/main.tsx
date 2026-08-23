import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CrashScreen } from './components/CrashScreen'
import { reportClientError } from './services/errorReporting'
import './styles/globals.css'

// Registered before React even mounts, and independent of the error
// boundary below — a render-phase exception (what the boundary catches)
// never reaches window.onerror or unhandledrejection, and vice versa
// (an error thrown from an event handler, a timer callback, or a
// rejected promise never reaches a render-phase error boundary). Both are
// needed for real crash visibility (issue #58): before this, neither
// category was logged anywhere.
window.addEventListener('error', (event) => {
  reportClientError(event.message, event.error?.stack, 'window.onerror')
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  reportClientError(message, stack, 'unhandledrejection')
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error) => <CrashScreen error={error} />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

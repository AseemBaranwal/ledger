import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CrashScreen } from './components/CrashScreen'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error) => <CrashScreen error={error} />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

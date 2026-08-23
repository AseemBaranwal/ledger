import { getCurrentUserId } from './userScope'

// Best-effort, fire-and-forget — a failure to REPORT a crash must never
// itself throw or block anything else. Before this (issue #58), a crash
// was completely invisible in production: no way to know it happened, how
// often, or on what device, beyond guessing from reading the code.
export function reportClientError(message: string, stack?: string, source?: string) {
  try {
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stack,
        source,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userId: getCurrentUserId(),
      }),
    }).catch(() => {})
  } catch {
    // ignore
  }
}

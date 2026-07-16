import type { Session } from '@/types'

export async function pushSession(sheetUrl: string, session: Session): Promise<void> {
  if (!sheetUrl) throw new Error('Sheet URL not configured')

  // text/plain is required here, not application/json: it's the request
  // stays within Apps Script's no-cors expectations. application/json isn't
  // a CORS-safelisted content type for a no-cors request, so some mobile
  // browsers drop/alter the request entirely rather than sending it as-is.
  const response = await fetch(sheetUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'session', ...session }),
  })

  if (!response.ok && response.status !== 0) {
    throw new Error('Failed to push session')
  }
}

export async function restoreFromSheet(sheetUrl: string) {
  if (!sheetUrl) throw new Error('Sheet URL not configured')

  const response = await fetch(`${sheetUrl}?action=export`)
  const data = await response.json()

  if (data.error) throw new Error(data.error)
  return data
}

export async function loadWeightsFromSheet(sheetUrl: string) {
  if (!sheetUrl) throw new Error('Sheet URL not configured')

  const response = await fetch(`${sheetUrl}?action=weights`)
  const data = await response.json()

  return data.weights || []
}

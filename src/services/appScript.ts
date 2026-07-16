import type { Session } from '@/types'

export async function pushSession(sheetUrl: string, session: Session): Promise<void> {
  if (!sheetUrl) throw new Error('Sheet URL not configured')

  const response = await fetch(sheetUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
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

import type { Session } from '@/types'

export async function pushSession(sheetUrl: string, session: Session): Promise<void> {
  if (!sheetUrl) throw new Error('Sheet URL not configured')

  // session.type ('PROGRAM' | 'REST') is our own internal UI marker — it must
  // NOT go out on the wire as `type`, because that key is overloaded here to
  // tell Apps Script what kind of record this is ('session'). Spreading the
  // session after {type:'session'} would let session.type clobber it, so the
  // backend silently sees type:'PROGRAM' instead of type:'session' and never
  // appends a row (no error surfaces because mode:'no-cors' hides the result).
  const { type: _uiType, ...sessionData } = session

  // text/plain is required here, not application/json: it's the request
  // stays within Apps Script's no-cors expectations. application/json isn't
  // a CORS-safelisted content type for a no-cors request, so some mobile
  // browsers drop/alter the request entirely rather than sending it as-is.
  const response = await fetch(sheetUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'session', ...sessionData }),
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

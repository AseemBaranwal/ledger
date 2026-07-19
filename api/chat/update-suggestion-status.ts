import { requireUser } from '../_lib/auth.js'
import { updateSuggestionStatus } from '../_lib/chatHistory.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

function isOwner(userId: string): boolean {
  const allowList = (process.env.CHAT_OWNER_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return allowList.includes(userId)
}

// Called right after the user taps Accept/Dismiss on a suggestion card, so
// the choice persists in chat_messages.suggestions instead of only living
// in local zustand state (which loadHistory() would otherwise overwrite
// back to "pending" on the very next Coach tab visit).
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  if (!isOwner(user.id)) {
    return new Response(JSON.stringify({ error: 'Not available for this account' }), { status: 403 })
  }

  let payload: { messageId?: number; suggestionIndex?: number; status?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const { messageId, suggestionIndex, status } = payload
  if (messageId == null || suggestionIndex == null || (status !== 'accepted' && status !== 'dismissed')) {
    return new Response(JSON.stringify({ error: 'Missing or invalid messageId/suggestionIndex/status' }), { status: 400 })
  }

  const ok = await updateSuggestionStatus(user.id, messageId, suggestionIndex, status)
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Could not update suggestion status' }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

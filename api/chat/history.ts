import { requireUser } from '../_lib/auth.js'
import { fetchChatHistory } from '../_lib/chatHistory.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

const HISTORY_LIMIT = 50

function isOwner(userId: string): boolean {
  const allowList = (process.env.CHAT_OWNER_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return allowList.includes(userId)
}

// Called once when the Coach tab mounts, so the conversation survives a
// page reload and follows the owner across devices (phone + laptop share
// one history) instead of being stuck in one browser's localStorage.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  if (!isOwner(user.id)) {
    return new Response(JSON.stringify({ error: 'Not available for this account' }), { status: 403 })
  }

  const messages = await fetchChatHistory(user.id, HISTORY_LIMIT)

  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

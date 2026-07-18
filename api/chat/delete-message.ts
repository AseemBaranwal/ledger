import { requireUser } from '../_lib/auth.js'
import { deleteChatMessages } from '../_lib/chatHistory.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

const MAX_IDS_PER_REQUEST = 10

function isOwner(userId: string): boolean {
  const allowList = (process.env.CHAT_OWNER_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return allowList.includes(userId)
}

// Lets the owner remove a turn (or a stray message) from the durable
// conversation — mainly so a wrong/misleading exchange can be excluded
// from the history a future turn slices into what actually gets sent to
// the model, not just hidden client-side.
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

  let payload: { ids?: unknown }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const ids = Array.isArray(payload.ids) ? payload.ids.filter((id): id is number => typeof id === 'number') : []
  if (!ids.length) {
    return new Response(JSON.stringify({ error: 'No message ids provided' }), { status: 400 })
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return new Response(JSON.stringify({ error: `Too many ids — max ${MAX_IDS_PER_REQUEST} per request` }), { status: 400 })
  }

  await deleteChatMessages(user.id, ids)

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

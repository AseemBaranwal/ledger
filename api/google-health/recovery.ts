import { requireUser } from '../_lib/auth.js'
import { getRecoveryData } from '../_lib/recoveryData.js'

// See disconnect.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

// Client-facing counterpart to the Coach's get_recovery_data tool — same
// fetch (recovery data is never persisted, unlike body weight; see
// recoveryData.ts's file comment for why fetching live is fine here), just
// reachable without a chat turn, for the Trends tab's new Recovery domain.
// Not owner-gated, same reasoning as weight.ts: only ever reads the calling
// user's own connection and own data.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const url = new URL(req.url)
  const daysParam = Number(url.searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30

  const result = await getRecoveryData(user.id, { days })

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

import { requireUser } from '../_lib/auth.js'
import { getBodyWeightData } from '../_lib/bodyWeightData.js'

// See disconnect.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

// Client-facing counterpart to the Coach's get_body_weight_data tool — same
// underlying fetch (and the same best-effort upsert into
// google_health_weight as a side effect), just reachable without going
// through a chat turn, for the Trends tab's weight chart. Not owner-gated —
// like every other Google Health endpoint, this only ever reads the calling
// user's OWN connection and OWN data, unlike the Coach chat which is
// deliberately owner-only regardless of who else might sign in.
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
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 90

  const result = await getBodyWeightData(user.id, { days })

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

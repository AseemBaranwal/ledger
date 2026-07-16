import type { Session, Exercise } from '@/types'
import { iso } from './dateUtils'

export function calculateVolume(exercise: Exercise, totalReps: number): number {
  if (!exercise.ws || exercise.ws.length === 0) {
    return (exercise.w || 0) * totalReps
  }
  const avgWeight = exercise.ws.reduce((a, b) => a + b, 0) / exercise.ws.length
  return avgWeight * totalReps
}

export function getMaxWeight(exercise: Exercise): number {
  if (!exercise.ws || exercise.ws.length === 0) {
    return exercise.w || 0
  }
  return Math.max(...exercise.ws)
}

// Total lb volume for one session — sum(reps * weight) per set
export function volume(s: Session): number {
  return (s.ex || []).reduce((t, e) => {
    const setVols = e.r.map((r, i) => {
      const w = e.ws ? e.ws[i] || 1 : e.w || 1
      return r * w
    })
    return t + setVols.reduce((a, v) => a + v, 0)
  }, 0)
}

// Find the most recent prior logging of an exercise code
export function lastOf(sessions: Session[], code: string): (Exercise & { d: string }) | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const e = sessions[i].ex?.find((x) => x.k === code)
    if (e && e.r.length) return { ...e, d: sessions[i].d }
  }
  return null
}

// Consecutive weeks (most recent first) with >= 3 logged sessions
export function streak(sessions: Session[]): number {
  const wk: Record<string, number> = {}
  sessions.forEach((s) => {
    const d = new Date(s.d + 'T12:00')
    const t = new Date(d)
    t.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    wk[iso(t)] = (wk[iso(t)] || 0) + 1
  })
  const keys = Object.keys(wk).sort().reverse()
  let n = 0
  for (const k of keys) {
    if (wk[k] >= 3) n++
    else break
  }
  return n
}

// Exercise codes that hit a new max weight in this session, vs all prior sessions
export function checkPRs(session: Session, allSessions: Session[]): string[] {
  const prs: string[] = []
  session.ex?.forEach((e) => {
    if (!e.r.length) return
    const curMax = e.ws ? Math.max(...e.ws) : e.w || 0
    const prior = allSessions
      .filter((x) => x !== session && x.d < session.d)
      .flatMap((x) => x.ex?.filter((y) => y.k === e.k) || [])
      .map((y) => (y.ws ? Math.max(...y.ws) : y.w || 0))
    if (prior.length && curMax > Math.max(...prior)) prs.push(e.k)
  })
  return prs
}

export function calculateTotalVolume(sessions: Session[], code: string): number {
  let total = 0
  sessions.forEach((s) => {
    s.ex?.forEach((e) => {
      if (e.k === code) {
        const reps = e.r.reduce((a, b) => a + b, 0)
        total += calculateVolume(e, reps)
      }
    })
  })
  return Math.round(total)
}

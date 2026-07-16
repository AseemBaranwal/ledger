import type { Session, Exercise } from '@/types'

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

export function checkPRs(sessions: Session[], code: string): number {
  const weights: number[] = []
  sessions.forEach((s) => {
    s.ex?.forEach((e) => {
      if (e.k === code) {
        if (e.ws) weights.push(...e.ws)
        else if (e.w) weights.push(e.w)
      }
    })
  })
  return Math.max(...weights, 0)
}

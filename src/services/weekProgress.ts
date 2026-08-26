// Pure "what's done/owed this week" logic, kept out of TodayTab.tsx (the
// app's largest component) so it's directly unit-testable, same as the
// sessionStore logic it sits next to.
import { iso, mondayOf } from './dateUtils'
import type { Session, Program, ProgramExercise } from '@/types'

export function doneThisWeek(sessions: Session[], today: Date = new Date()): Set<string> {
  const mon = mondayOf(today)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  const sunStr = iso(sun)
  const set = new Set<string>()
  sessions.forEach((x) => {
    if (x.d >= mon && x.d <= sunStr && x.s) set.add(x.s)
  })
  return set
}

// Takes `done` as a parameter rather than recomputing doneThisWeek()
// internally — the original inline version called it twice per render
// (once directly, once again inside this function) for the same result.
export function owedThisWeek(program: Program, priority: string[], weekDays: number[], dayOfWeek: number, done: Set<string>): string[] {
  const todayPos = weekDays.indexOf(dayOfWeek)
  return priority.filter((k) => program[k] && weekDays.indexOf(program[k].day) <= todayPos && !done.has(k))
}

export function tgtStr(e: ProgramExercise): string {
  let t = `${e.s}×${e.r}`
  if (e.w > 0) t += e.u === '+lb' ? ` · +${e.w} lb` : ` · ${e.w} ${e.u === 'reps' ? '' : e.u}`.trimEnd()
  return t
}

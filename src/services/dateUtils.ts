// Local timezone ISO date (not UTC)
export function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr(): string {
  return iso(new Date())
}

export function dayName(d: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[d] || 'Unknown'
}

export function weekNumber(d: Date): number {
  const first = new Date(d.getFullYear(), 0, 1)
  const diff = d.getTime() - first.getTime()
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000))
}

export function mondayOf(d: Date): string {
  const t = new Date(d)
  const off = (t.getDay() + 6) % 7
  t.setDate(t.getDate() - off)
  return iso(t)
}

export function ago(ds: string): string {
  const n = Math.round((new Date(todayStr()).getTime() - new Date(ds).getTime()) / 864e5)
  if (n === 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 7) return n + 'd ago'
  if (n < 30) return Math.round(n / 7) + 'w ago'
  return Math.round(n / 30) + 'mo ago'
}

export function fmtD(ds: string): string {
  const d = new Date(ds + 'T12:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

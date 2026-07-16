// Local timezone ISO date (not UTC)
export function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

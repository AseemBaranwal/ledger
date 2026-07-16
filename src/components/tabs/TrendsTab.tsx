import { useSessionStore, useConfigStore, useUIStore } from '@/store'
import styles from '../../styles/components.module.css'

export function TrendsTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const selectedGroup = useUIStore((s) => s.selectedTrendGroup)
  const setTrendGroup = useUIStore((s) => s.setTrendGroup)

  const groups = Array.from(new Set(Object.values(program).flatMap((p) => p.ex.map((e) => e.group))))

  const filteredExercises = Object.values(program)
    .flatMap((p) => p.ex)
    .filter((e) => selectedGroup === 'All' || e.group === selectedGroup)

  const getProgressData = (code: string) => {
    const points: Array<{ date: string; weight: number }> = []
    sessions
      .filter((s) => s.s) // Only PROGRAM sessions
      .forEach((s) => {
        s.ex?.forEach((e) => {
          if (e.k === code) {
            const weights = e.ws || (e.w ? [e.w] : [])
            const maxWeight = Math.max(...weights, 0)
            if (maxWeight > 0) {
              points.push({ date: s.d, weight: maxWeight })
            }
          }
        })
      })
    return points
  }

  const getMaxWeight = (code: string) => {
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

  const SimpleLineChart = ({ data, maxVal }: { data: Array<{ date: string; weight: number }>; maxVal: number }) => {
    if (data.length < 2) return <div style={{ color: 'var(--dim)', fontSize: '12px' }}>No data yet</div>

    const width = 300
    const height = 80
    const padding = 10
    const plotWidth = width - padding * 2
    const plotHeight = height - padding * 2

    const points = data.map((d, i) => ({
      x: padding + (i / (data.length - 1)) * plotWidth,
      y: height - padding - (d.weight / maxVal) * plotHeight,
    }))

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

    return (
      <svg width={width} height={height} style={{ display: 'block', marginBottom: '8px' }} viewBox={`0 0 ${width} ${height}`}>
        <path d={pathD} stroke="var(--amber)" strokeWidth="2" fill="none" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--amber)" />
        ))}
      </svg>
    )
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '12px' }}>Trends</h2>

      <select
        className={styles.pick}
        value={selectedGroup}
        onChange={(e) => setTrendGroup(e.target.value)}
      >
        <option value="All">All Exercises</option>
        {groups.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>

      {filteredExercises.length === 0 ? (
        <p style={{ color: 'var(--dim)' }}>No exercises in this group</p>
      ) : (
        filteredExercises.map((ex) => {
          const maxW = getMaxWeight(ex.k)
          const data = getProgressData(ex.k)
          return (
            <div key={ex.k} className={styles.chartCard}>
              <div className={styles.chartHd}>
                <h3>{ex.n}</h3>
                <div className={styles.delta}>
                  <strong>{maxW}</strong> {ex.u}
                </div>
              </div>
              <SimpleLineChart data={data} maxVal={maxW || 100} />
              <div style={{ fontSize: '11px', color: 'var(--dim)' }}>{data.length} workouts tracked</div>
            </div>
          )
        })
      )}
    </div>
  )
}

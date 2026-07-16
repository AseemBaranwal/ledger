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
          return (
            <div key={ex.k} className={styles.chartCard}>
              <div className={styles.chartHd}>
                <h3>{ex.n}</h3>
                <div className={styles.delta}>
                  <strong>{maxW}</strong> {ex.u}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--dim)' }}>Max weight tracked</div>
            </div>
          )
        })
      )}
    </div>
  )
}

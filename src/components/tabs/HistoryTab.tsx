import { useSessionStore, useUIStore } from '@/store'
import styles from '../../styles/components.module.css'

export function HistoryTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const toggleExpand = useUIStore((s) => s.toggleExpandHistory)

  const groupedByWeek = sessions.reduce(
    (acc, session) => {
      const date = new Date(session.d)
      const week = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))
      if (!acc[week]) acc[week] = []
      acc[week].push(session)
      return acc
    },
    {} as Record<number, typeof sessions>
  )

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '16px' }}>Session History</h2>
      {sessions.length === 0 ? (
        <p style={{ color: 'var(--dim)' }}>No sessions logged yet</p>
      ) : (
        Object.values(groupedByWeek)
          .reverse()
          .map((week) => (
            <div key={week[0].d}>
              <h3 style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '12px', marginBottom: '8px' }}>
                Week {week[0].d}
              </h3>
              {week.map((session) => (
                <div
                  key={session.id}
                  className={styles.hrow}
                  onClick={() => toggleExpand(session.id!)}
                  style={{ cursor: 'pointer', marginBottom: '8px' }}
                >
                  <div className={styles.bar} style={{ background: 'var(--amber)' }} />
                  <div className={styles.m}>
                    <div className={styles.t}>{session.s || 'REST'}</div>
                    <div className={styles.s}>{session.d}</div>
                  </div>
                  <div className={styles.v}>
                    <b>{session.ex?.length || 0}</b>
                    exercises
                  </div>
                </div>
              ))}
            </div>
          ))
      )}
    </div>
  )
}

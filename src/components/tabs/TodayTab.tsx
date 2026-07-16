import { useState } from 'react'
import { useSessionStore, useConfigStore } from '@/store'
import styles from '../../styles/components.module.css'

export function TodayTab() {
  const draft = useSessionStore((s) => s.draft)
  const program = useConfigStore((s) => s.program)
  const restDays = useConfigStore((s) => s.restDays)
  const [today] = useState(new Date())
  const dayOfWeek = today.getDay()

  const todayRest = restDays[dayOfWeek]
  const todayProgram = Object.values(program).find((p) => p.day === dayOfWeek)

  if (!draft) {
    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ marginBottom: '16px' }}>Today's Plan</h2>
        {todayRest ? (
          <div>
            <h3>{todayRest.t}</h3>
            <p style={{ color: 'var(--dim)', fontSize: '12px', marginTop: '8px' }}>
              {todayRest.s}
            </p>
          </div>
        ) : todayProgram ? (
          <div className={styles.card}>
            <div style={{ padding: '14px' }}>
              <h3>{todayProgram.full}</h3>
              <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                {todayProgram.ex.length} exercises
              </p>
              <button
                className={styles.btn}
                style={{ background: 'var(--amber)', color: '#14181D', marginTop: '12px' }}
                onClick={() => {
                  useSessionStore.setState({
                    draft: {
                      d: today.toISOString().split('T')[0],
                      s: Object.entries(program).find(([, p]) => p === todayProgram)?.[0],
                      g: todayProgram.gym,
                      ex: todayProgram.ex.map((e) => ({ k: e.k, r: [], ws: [] })),
                      type: 'PROGRAM',
                    },
                  })
                }}
              >
                Start {todayProgram.name}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--dim)' }}>No session planned for today</p>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Logging {draft.s}...</h2>
      <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
        {draft.ex?.length || 0} exercises
      </p>
      <div style={{ marginTop: '20px', color: 'var(--dim)' }}>
        [Exercise logging UI — Phase 5]
      </div>
    </div>
  )
}

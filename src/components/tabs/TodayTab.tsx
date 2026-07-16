import { useState } from 'react'
import { useSessionStore, useConfigStore } from '@/store'
import styles from '../../styles/components.module.css'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const COLORS: Record<string, string> = {
  'Lower A': 'var(--green)',
  'Lower B': 'var(--green)',
  'Push': 'var(--blue)',
  'Pull': 'var(--purple)',
  'Sprints': 'var(--red)',
  'Easy Run + Core': 'var(--yellow)',
  'Full Rest': 'var(--dim)',
  'Skating': 'var(--cyan)',
}

export function TodayTab() {
  const draft = useSessionStore((s) => s.draft)
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const restDays = useConfigStore((s) => s.restDays)
  const [today] = useState(new Date())
  const dayOfWeek = today.getDay()

  const getSessionForDay = (day: number) => {
    const rest = restDays[day]
    if (rest) return rest
    return Object.values(program).find((p) => p.day === day)
  }

  const getSessionCode = (day: number) => {
    return Object.entries(program).find(([, p]) => p.day === day)?.[0]
  }

  // Get owed sessions for the week
  const owedSessions = Object.entries(program)
    .filter(([_, p]) => [1, 2, 4, 6].includes(p.day))
    .filter(([code]) => !sessions.some((s) => s.s === code && s.d.startsWith(today.toISOString().split('T')[0].slice(0, 7))))
    .map(([code, session]) => ({ code, session }))

  const startSession = (session: any, code: string, date: string) => {
    useSessionStore.setState({
      draft: {
        d: date,
        s: code,
        g: session.gym,
        ex: session.ex.map((e: any) => ({ k: e.k, r: [], ws: [] })),
        type: 'PROGRAM',
      },
    })
  }

  if (!draft) {
    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ marginBottom: '16px' }}>This Week</h2>

        {/* Week Calendar */}
        <div className={styles.card} style={{ marginBottom: '20px' }}>
          {Array.from({ length: 7 }).map((_, i) => {
            const session = getSessionForDay(i)
            const isToday = i === dayOfWeek
            const code = getSessionCode(i)
            const isProgram = session && !('t' in session)
            const sessionDate = new Date(today)
            sessionDate.setDate(today.getDate() - dayOfWeek + i)
            const dateStr = sessionDate.toISOString().split('T')[0]

            const sessionLabel = isProgram ? (session as any).full : (session as any)?.t

            return (
              <div key={i}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px',
                    borderLeft: isToday ? '4px solid var(--amber)' : '4px solid transparent',
                    background: isToday ? 'rgba(217, 119, 6, 0.08)' : 'transparent',
                    cursor: isProgram && code ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (isProgram && code) {
                      startSession(session, code, dateStr)
                    }
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                      {DAYS[i]} {isToday ? '- TODAY' : ''}
                    </div>
                    <div
                      style={{
                        fontWeight: session ? 'bold' : 'normal',
                        color: session ? COLORS[sessionLabel] : 'var(--muted)',
                        fontSize: '14px',
                      }}
                    >
                      {sessionLabel || 'Rest'}
                    </div>
                  </div>
                  {isProgram && code && (
                    <div style={{ fontSize: '10px', color: 'var(--muted)' }}>›</div>
                  )}
                </div>
                {i < 6 && <div style={{ height: '1px', background: 'var(--line)' }} />}
              </div>
            )
          })}
        </div>

        {/* Today's Details */}
        {!restDays[dayOfWeek] && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px' }}>
              TODAY'S EXERCISES
            </h3>
            <div className={styles.card}>
              {(getSessionForDay(dayOfWeek) as any)?.ex?.map((e: any) => (
                <div
                  key={e.k}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--line)',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{e.n}</div>
                  <div style={{ fontSize: '11px', color: 'var(--dim)' }}>
                    {e.s} sets | {e.u}
                  </div>
                </div>
              ))}
              <button
                className={styles.btn}
                style={{
                  background: 'var(--amber)',
                  color: '#14181D',
                  margin: '12px',
                  display: 'block',
                  width: 'calc(100% - 24px)',
                }}
                onClick={() => {
                  const session = getSessionForDay(dayOfWeek)
                  const code = getSessionCode(dayOfWeek)
                  if (session && code) {
                    startSession(session, code, today.toISOString().split('T')[0])
                  }
                }}
              >
                Start {(getSessionForDay(dayOfWeek) as any)?.name}
              </button>
            </div>
          </div>
        )}

        {/* Owed Sessions */}
        {owedSessions.length > 0 && (
          <div>
            <h3 style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '12px' }}>
              STILL OWED THIS WEEK
            </h3>
            {owedSessions.map(({ code, session }) => (
              <button
                key={code}
                className={styles.btn}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  marginBottom: '8px',
                  padding: '12px',
                  width: '100%',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  startSession(session, code, today.toISOString().split('T')[0])
                }}
              >
                {session.name}
              </button>
            ))}
          </div>
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

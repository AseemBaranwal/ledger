import { useState } from 'react'
import { useSessionStore, useConfigStore } from '@/store'
import { ExerciseLogger } from '@/components/session'
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
  const saveDraft = useSessionStore((s) => s.saveDraft)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const restDays = useConfigStore((s) => s.restDays)
  const [today] = useState(new Date())
  const dayOfWeek = today.getDay()
  const [expandedDay, setExpandedDay] = useState<number | null>(null)

  const getSessionForDay = (day: number) => {
    const rest = restDays[day]
    if (rest) return rest
    return Object.values(program).find((p) => p.day === day)
  }

  const getSessionCode = (day: number) => {
    return Object.entries(program).find(([, p]) => p.day === day)?.[0]
  }

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

  // Logging mode - show exercise logger
  if (draft) {
    const session = getSessionForDay(dayOfWeek)
    const sessionName = (session as any)?.full || (session as any)?.name
    const code = draft.s

    return (
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '4px' }}>{sessionName}</h2>
          <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {draft.ex?.length || 0} exercises · {code}
          </p>
        </div>

        {/* Exercise Loggers */}
        {draft.ex?.map((_, index) => (
          <ExerciseLogger key={index} exercise={(draft.ex![index] as any)} index={index} />
        ))}

        {/* Save Button */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
          <button
            className={styles.btn}
            style={{
              flex: 1,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
            }}
            onClick={clearDraft}
          >
            Cancel
          </button>
          <button
            className={styles.btn}
            style={{
              flex: 1,
              background: 'var(--amber)',
              color: '#14181D',
            }}
            onClick={() => {
              saveDraft()
              clearDraft()
            }}
          >
            Save Session
          </button>
        </div>
      </div>
    )
  }

  // Overview mode
  return (
    <div style={{ padding: '20px' }}>
      {/* THIS WEEK */}
      <h3 style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px' }}>
        THIS WEEK
      </h3>
      <div className={styles.card} style={{ marginBottom: '20px' }}>
        {Array.from({ length: 7 }).map((_, i) => {
          const session = getSessionForDay(i)
          const isToday = i === dayOfWeek
          const code = getSessionCode(i)
          const isProgram = session && !('t' in session)
          const sessionDate = new Date(today)
          sessionDate.setDate(today.getDate() - dayOfWeek + i)
          const dateStr = sessionDate.toISOString().split('T')[0]
          const isExpanded = expandedDay === i

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
                  cursor: isProgram ? 'pointer' : 'default',
                }}
                onClick={() => {
                  setExpandedDay(isExpanded ? null : i)
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
                {isProgram && <div style={{ fontSize: '10px', color: 'var(--muted)' }}>›</div>}
              </div>

              {/* Expanded exercises */}
              {isExpanded && isProgram && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px' }}>
                  {(session as any)?.ex?.map((e: any) => (
                    <div
                      key={e.k}
                      style={{
                        fontSize: '13px',
                        marginBottom: '8px',
                        paddingBottom: '8px',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{e.n}</div>
                      <div style={{ fontSize: '11px', color: 'var(--dim)' }}>
                        {e.s} × {e.r} | {e.u}
                      </div>
                      {e.cue && (
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                          {e.cue}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    className={styles.btn}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      width: '100%',
                      marginTop: '8px',
                    }}
                    onClick={() => {
                      startSession(session, code!, dateStr)
                      setExpandedDay(null)
                    }}
                  >
                    Start {(session as any)?.name} →
                  </button>
                </div>
              )}

              {i < 6 && <div style={{ height: '1px', background: 'var(--line)' }} />}
            </div>
          )
        })}
      </div>

      {/* STILL OWED */}
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

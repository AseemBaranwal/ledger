import { useState, useMemo } from 'react'
import { useSessionStore, useConfigStore } from '@/store'
import styles from '../../styles/components.module.css'

interface ExerciseLoggerProps {
  exercise: any
  index: number
}

export function ExerciseLogger({ exercise, index }: ExerciseLoggerProps) {
  const draft = useSessionStore((s) => s.draft)
  const program = useConfigStore((s) => s.program)
  const logRep = useSessionStore((s) => s.logRep)

  const exerciseDef = useMemo(() => {
    if (!program || !draft?.s) return null
    const session = program[draft.s]
    return session?.ex?.find((e: any) => e.k === exercise.k)
  }, [program, draft, exercise])

  const [weight, setWeight] = useState(exerciseDef?.w || 0)

  if (!draft || !draft.ex || !exerciseDef) return null

  const currentEx = draft.ex[index]
  const repsLogged = currentEx?.r?.length || 0

  const handleLogRep = () => {
    logRep(index, exerciseDef.r, [weight])
  }

  return (
    <div className={styles.card} style={{ marginBottom: '12px' }}>
      <div style={{ padding: '12px' }}>
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '15px', marginBottom: '4px' }}>
            {exerciseDef.n}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {exerciseDef.s} × {exerciseDef.r} reps
          </div>
        </div>

        {exerciseDef.cue && (
          <div style={{ fontSize: '12px', color: 'var(--dim)', marginBottom: '12px', fontStyle: 'italic' }}>
            {exerciseDef.cue}
          </div>
        )}

        {/* Weight Stepper */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <button
            className={styles.btn}
            style={{
              width: '40px',
              padding: '8px',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
            }}
            onClick={() => setWeight(Math.max(0, weight - 2.5))}
          >
            −
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
              style={{
                width: '70px',
                fontSize: '20px',
                fontWeight: 'bold',
                textAlign: 'center',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                padding: '8px',
                borderRadius: '4px',
                color: 'var(--amber)',
              }}
            />
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              {exerciseDef.u}
            </div>
          </div>
          <button
            className={styles.btn}
            style={{
              width: '40px',
              padding: '8px',
              background: 'var(--amber)',
              color: '#14181D',
              border: 'none',
            }}
            onClick={() => setWeight(weight + 2.5)}
          >
            +
          </button>
        </div>

        {/* Set Tracker */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {Array.from({ length: exerciseDef.s }).map((_, i) => (
            <button
              key={i}
              onClick={handleLogRep}
              style={{
                padding: '12px 8px',
                background: i < repsLogged ? 'var(--amber)' : 'var(--surface)',
                border: `2px solid ${i < repsLogged ? 'var(--amber)' : 'var(--line)'}`,
                borderRadius: '6px',
                color: i < repsLogged ? '#14181D' : 'var(--muted)',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              SET {i + 1}
            </button>
          ))}
        </div>

        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px', textAlign: 'center' }}>
          {repsLogged} of {exerciseDef.s} sets logged
        </div>
      </div>
    </div>
  )
}

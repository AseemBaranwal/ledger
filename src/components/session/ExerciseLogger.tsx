import { useState } from 'react'
import { useSessionStore } from '@/store'
import type { ProgramExercise } from '@/types'
import styles from '../../styles/components.module.css'

interface ExerciseLoggerProps {
  exercise: ProgramExercise
  index: number
}

export function ExerciseLogger({ exercise, index }: ExerciseLoggerProps) {
  const draft = useSessionStore((s) => s.draft)
  const [weight, setWeight] = useState(exercise.w)

  const logRep = useSessionStore((s) => s.logRep)

  const handleLogRep = () => {
    logRep(index, exercise.r, [weight])
  }

  if (!draft || !draft.ex) return null

  const currentEx = draft.ex[index]
  const repsLogged = currentEx?.r?.length || 0

  return (
    <div className={styles.card} style={{ marginBottom: '12px' }}>
      <div className={styles.exHead}>
        <div>
          <div className={styles.exName}>{exercise.n}</div>
          <div className={styles.exTarget}>
            {exercise.s}x{exercise.r} @ {weight}{exercise.u}
          </div>
        </div>
      </div>

      <div className={styles.exCue}>{exercise.cue}</div>

      <div className={styles.stepper}>
        <button
          className={styles.stepBtn}
          onClick={() => setWeight(Math.max(0, weight - 2.5))}
        >
          −
        </button>
        <div className={styles.stepVal}>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
          />
          <span className={styles.unit}>{exercise.u}</span>
        </div>
        <button
          className={styles.stepBtn}
          onClick={() => setWeight(weight + 2.5)}
        >
          +
        </button>
      </div>

      <div className={styles.sets}>
        {Array.from({ length: exercise.s }).map((_, i) => (
          <button
            key={i}
            className={`${styles.blk} ${i < repsLogged ? styles.filled : ''}`}
            onClick={handleLogRep}
          >
            <span className={styles.n}>{i + 1}</span>
            <span className={styles.lab}>Set</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '0 14px 12px', fontSize: '12px', color: 'var(--muted)' }}>
        {repsLogged}/{exercise.s} sets logged
      </div>
    </div>
  )
}

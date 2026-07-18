import { useSessionStore, useUIStore } from '@/store'
import type { ProgramExercise } from '@/types'
import { lastOf } from '@/services/trendCalculations'
import { ago } from '@/services/dateUtils'
import { unlockAudioContext } from '@/services/audio'
import { StarIcon, CloseIcon } from '@/components/icons/Icons'
import styles from '../../styles/components.module.css'

interface ExerciseLoggerProps {
  def: ProgramExercise
  index: number
}

const INCREMENTS = [2.5, 5, 10, 25]

function repOpts(target: number): number[] {
  const o = new Set<number>()
  for (let v = Math.max(1, target - 4); v <= target + 4; v++) o.add(v)
  return [...o]
}

export function ExerciseLogger({ def, index }: ExerciseLoggerProps) {
  const draftEx = useSessionStore((s) => s.draftEx)
  const sessions = useSessionStore((s) => s.sessions)
  const bumpWeight = useSessionStore((s) => s.bumpWeight)
  const setWeight = useSessionStore((s) => s.setWeight)
  const logRep = useSessionStore((s) => s.logRep)
  const clearSet = useSessionStore((s) => s.clearSet)

  const weightIncrement = useUIStore((s) => s.weightIncrement)
  const setWeightIncrement = useUIStore((s) => s.setWeightIncrement)
  const openExerciseIndex = useUIStore((s) => s.openExerciseIndex)
  const setOpenExerciseIndex = useUIStore((s) => s.setOpenExerciseIndex)

  if (!draftEx || !draftEx[index]) return null
  const ex = draftEx[index]
  const last = lastOf(sessions, def.k)
  const full = ex.r.length >= def.s
  const isOpen = openExerciseIndex === index

  const handleLogRep = (v: number) => {
    unlockAudioContext() // must happen inside this click handler, not later, or mobile browsers mute it
    logRep(index, v)
    setOpenExerciseIndex(ex.r.length + 1 >= def.s ? null : index)
    useUIStore.getState().setTimer(90, true)
  }

  return (
    <div className={`${styles.card} ${full ? styles.done : ''}`}>
      <div className={styles.exHead}>
        <div className={styles.exName}>
          {def.n.includes('★') ? (
            <>
              {def.n.replace('★', '')}
              <span className={styles.star}>
                {' '}
                <StarIcon />
              </span>
            </>
          ) : def.n}
        </div>
        <div className={`${styles.exTarget} mono`}>
          {def.s}×{def.r}
        </div>
      </div>

      {last ? (
        <div className={`${styles.exLast} mono`}>
          Last: <b>{last.ws ? last.ws.join(',') : last.w}{def.u === '+lb' ? ' extra' : ''} × {last.r.join(',')}</b> · {ago(last.d)}
        </div>
      ) : (
        <div className={styles.exLast}>First time. Start at the target and see how it moves.</div>
      )}

      <div className={styles.exCue}>{def.cue}</div>

      <div className={styles.stepper}>
        <button className={styles.stepBtn} onClick={() => bumpWeight(index, -1, weightIncrement)}>
          −
        </button>
        <div className={styles.stepVal}>
          <input
            className="mono"
            type="number"
            inputMode="decimal"
            value={ex.w}
            onChange={(e) => setWeight(index, parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.target.select()}
          />
          <span className={styles.unit}>{def.u === '+lb' ? 'EXTRA LB' : def.u.toUpperCase()}</span>
        </div>
        <button className={styles.stepBtn} onClick={() => bumpWeight(index, 1, weightIncrement)}>
          +
        </button>
      </div>

      <div className={styles.incSel}>
        {INCREMENTS.map((v) => (
          <button
            key={v}
            className={`${styles.inc} ${weightIncrement === v ? styles.on : ''}`}
            onClick={() => setWeightIncrement(v)}
          >
            {v}
          </button>
        ))}
      </div>

      <div className={styles.sets}>
        {Array.from({ length: Math.max(def.s, ex.r.length) }).map((_, j) => {
          const v = ex.r[j]
          if (v == null) {
            return (
              <button key={j} className={styles.blk} onClick={() => setOpenExerciseIndex(index)}>
                <span className={styles.n}>–</span>
                <span className={styles.lab}>Set {j + 1}</span>
              </button>
            )
          }
          const cls = v > def.r ? styles.over : v < def.r ? styles.under : styles.filled
          return (
            <button key={j} className={`${styles.blk} ${cls}`} onClick={() => clearSet(index, j)}>
              <span className={styles.n}>{v}</span>
              <span className={styles.lab}>Set {j + 1}</span>
            </button>
          )
        })}
      </div>

      {isOpen && (
        <div className={styles.reps}>
          {repOpts(def.r).map((v) => (
            <button
              key={v}
              className={`${styles.rep} ${v === def.r ? styles.tgt : ''}`}
              onClick={() => handleLogRep(v)}
            >
              {v}
            </button>
          ))}
          <button className={`${styles.rep} ${styles.x}`} onClick={() => setOpenExerciseIndex(null)}>
            <CloseIcon size="15px" />
          </button>
        </div>
      )}
    </div>
  )
}

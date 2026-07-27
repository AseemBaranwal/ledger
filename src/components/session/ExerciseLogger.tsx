import { useState } from 'react'
import { useSessionStore, useUIStore } from '@/store'
import type { ProgramExercise } from '@/types'
import { lastOf } from '@/services/trendCalculations'
import { ago } from '@/services/dateUtils'
import { unlockAudioContext } from '@/services/audio'
import { StarIcon, CloseIcon, SwapIcon, TrashIcon } from '@/components/icons/Icons'
import { EquipmentIcon } from '@/components/icons/EquipmentIcon'
import { equipmentForCode } from '@/services/exerciseCatalog'
import styles from '../../styles/components.module.css'

interface ExerciseLoggerProps {
  def: ProgramExercise
  index: number
  onRequestSwap?: (index: number) => void
  onRequestRemove?: (index: number) => void
}

const INCREMENTS = [2.5, 5, 10, 25]

// Reuses the app's existing teal/amber/coral color language (already used
// for over/on-target/under rep counts elsewhere on this card) rather than
// introducing a new one — easy reads as "good, room to push," hard reads
// as "struggled," same as those colors already mean.
const EFFORTS: Array<{ v: 'e' | 'o' | 'h'; label: string; cls: string }> = [
  { v: 'e', label: 'Easy', cls: 'easy' },
  { v: 'o', label: 'OK', cls: 'ok' },
  { v: 'h', label: 'Hard', cls: 'hard' },
]

function repOpts(target: number): number[] {
  const o = new Set<number>()
  for (let v = Math.max(1, target - 4); v <= target + 4; v++) o.add(v)
  return [...o]
}

export function ExerciseLogger({ def, index, onRequestSwap, onRequestRemove }: ExerciseLoggerProps) {
  // Narrowed to this card's own entry, not the whole draftEx array — every
  // set-logging action replaces the array via [...state.draftEx] with only
  // one index actually patched, so subscribing to the full array here made
  // every other mounted card re-render on every single tap, not just the
  // one that changed.
  const ex = useSessionStore((s) => s.draftEx?.[index])
  const sessions = useSessionStore((s) => s.sessions)
  const bumpWeight = useSessionStore((s) => s.bumpWeight)
  const setWeight = useSessionStore((s) => s.setWeight)
  const logRep = useSessionStore((s) => s.logRep)
  const clearSet = useSessionStore((s) => s.clearSet)

  const weightIncrement = useUIStore((s) => s.weightIncrement)
  const setWeightIncrement = useUIStore((s) => s.setWeightIncrement)
  const openExerciseIndex = useUIStore((s) => s.openExerciseIndex)
  const setOpenExerciseIndex = useUIStore((s) => s.setOpenExerciseIndex)

  // Purely optional tag for the set about to be logged — tapping a rep
  // count with nothing selected here logs exactly as before (zero added
  // friction). Resets after every log so a selection never silently
  // carries over and mislabels the next set.
  const [pendingEffort, setPendingEffort] = useState<'e' | 'o' | 'h' | null>(null)

  // openExerciseIndex now means "this card is expanded" (the accordion
  // state — only one card expanded at a time, reusing the exact state
  // that used to gate just the rep picker). Whether the rep picker itself
  // is showing is a separate, narrower flag scoped to this one card: every
  // empty set slot logs to the same "next set" regardless of which slot
  // was tapped (logRep always appends), so one boolean is enough — there's
  // never a need to track which slot opened it.
  const [pickerOpen, setPickerOpen] = useState(false)

  if (!ex) return null
  const last = lastOf(sessions, def.k)
  const full = ex.r.length >= def.s
  const isOpen = openExerciseIndex === index

  const handleLogRep = (v: number) => {
    unlockAudioContext() // must happen inside this click handler, not later, or mobile browsers mute it
    logRep(index, v, pendingEffort)
    setPendingEffort(null)
    // Auto-continue for back-to-back sets on the same exercise (unchanged
    // from before); once fully done, collapse the whole card back into
    // the accordion instead of just closing the picker — the natural
    // extension of the old "close and move on" behavior in a collapsed list.
    if (ex.r.length + 1 >= def.s) {
      setPickerOpen(false)
      setOpenExerciseIndex(null)
    } else {
      setPickerOpen(true)
    }
    useUIStore.getState().setTimer(90, true)
  }

  const setsDone = ex.r.length

  if (!isOpen) {
    return (
      <button
        className={`${styles.card} ${styles.collapsedRow} ${full ? styles.done : ''}`}
        onClick={() => setOpenExerciseIndex(index)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--dim)', flex: 'none' }}>
          <EquipmentIcon equipment={equipmentForCode(def.k)} size="17px" />
        </span>
        <span className={styles.collapsedName}>
          {def.n.includes('★') ? def.n.replace('★', '') : def.n}
          {last && (
            <span className={`${styles.collapsedMeta} mono`}>
              {last.ws ? last.ws.join(',') : last.w}{def.u === '+lb' ? ' extra' : ''} × {last.r.join(',')}
            </span>
          )}
        </span>
        <span className={styles.pips}>
          {Array.from({ length: def.s }).map((_, j) => (
            <span key={j} className={`${styles.pip} ${j < setsDone ? styles.pipDone : ''}`} />
          ))}
        </span>
      </button>
    )
  }

  return (
    <div className={`${styles.card} ${full ? styles.done : ''}`}>
      <div className={styles.exHead}>
        <button className={styles.exName} onClick={() => setOpenExerciseIndex(null)} title="Collapse">
          <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--dim)', flex: 'none' }}>
            <EquipmentIcon equipment={equipmentForCode(def.k)} size="17px" />
          </span>
          {def.n.includes('★') ? (
            <>
              {def.n.replace('★', '')}
              <span className={styles.star}>
                {' '}
                <StarIcon />
              </span>
            </>
          ) : def.n}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' }}>
          <div className={`${styles.exTarget} mono`}>
            {def.s}×{def.r}
          </div>
          {onRequestSwap && (
            <button
              className={styles.exIconBtn}
              onClick={() => onRequestSwap(index)}
              title="Swap this exercise for an alternate"
            >
              <SwapIcon size="15px" />
            </button>
          )}
          {ex.r.length === 0 && onRequestRemove && (
            <button
              className={styles.exIconBtn}
              onClick={() => onRequestRemove(index)}
              title="Remove this exercise from today's session"
            >
              <TrashIcon size="15px" />
            </button>
          )}
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
        {/* Always render one empty slot past the last logged set, even once
            def.s is reached — otherwise there's no way to log a set beyond
            the program's target (e.g. an extra AMRAP set). */}
        {Array.from({ length: Math.max(def.s, ex.r.length + 1) }).map((_, j) => {
          const v = ex.r[j]
          if (v == null) {
            return (
              <button key={j} className={styles.blk} onClick={() => setPickerOpen(true)}>
                <span className={styles.n}>–</span>
                <span className={styles.lab}>Set {j + 1}</span>
              </button>
            )
          }
          const cls = v > def.r ? styles.over : v < def.r ? styles.under : styles.filled
          const effort = ex.ef?.[j]
          const effortCls = effort === 'e' ? styles.easy : effort === 'o' ? styles.ok : effort === 'h' ? styles.hard : ''
          return (
            <button key={j} className={`${styles.blk} ${cls}`} onClick={() => clearSet(index, j)}>
              {effort && <span className={`${styles.effDot} ${effortCls}`} title={EFFORTS.find((e) => e.v === effort)?.label} />}
              <span className={styles.n}>{v}</span>
              <span className={styles.lab}>Set {j + 1}</span>
            </button>
          )
        })}
      </div>

      {pickerOpen && (
        <div className={styles.effortSel}>
          {EFFORTS.map((e) => (
            <button
              key={e.v}
              className={`${styles.effPill} ${styles[e.cls]} ${pendingEffort === e.v ? styles.on : ''}`}
              onClick={() => setPendingEffort(pendingEffort === e.v ? null : e.v)}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}

      {pickerOpen && (
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
          <button className={`${styles.rep} ${styles.x}`} onClick={() => setPickerOpen(false)} aria-label="Close rep picker">
            <CloseIcon size="15px" />
          </button>
        </div>
      )}
    </div>
  )
}

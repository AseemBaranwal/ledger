import { memo, useState } from 'react'
import { useSessionStore, useUIStore, useUnitStore } from '@/store'
import type { ProgramExercise } from '@/types'
import { lastOf, formatLastSets } from '@/services/trendCalculations'
import { ago } from '@/services/dateUtils'
import { unlockAudioContext } from '@/services/audio'
import { StarIcon, CloseIcon, SwapIcon, TrashIcon, CheckIcon } from '@/components/icons/Icons'
import { EquipmentIcon } from '@/components/icons/EquipmentIcon'
import { equipmentForCode } from '@/services/exerciseCatalog'
import { displayWeight, toStoredLb, isWeightUnit, unitLabel, INCREMENTS_BY_SYSTEM } from '@/services/units'
import styles from '../../styles/components.module.css'

interface ExerciseLoggerProps {
  def: ProgramExercise
  index: number
  onRequestSwap?: (index: number) => void
  onRequestRemove?: (index: number) => void
}

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

// Memoized because TodayTab re-renders on every single set logged, weight
// bumped, or notes keystroke (draftEx/draft replace by reference on any
// change) — without this, every OTHER mounted card re-rendered too on each
// of those, not just the one that actually changed, each re-run redoing
// lastOf()'s full session-history scan. def/index are referentially stable
// across unrelated re-renders (draftDefs/p.ex don't change unless an actual
// swap/add/remove happens), so a shallow-prop memo is enough — it just also
// requires the two callback props to be stable, which TodayTab now provides
// via useCallback.
export const ExerciseLogger = memo(function ExerciseLogger({ def, index, onRequestSwap, onRequestRemove }: ExerciseLoggerProps) {
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

  // Falls back to imperial (i.e. no conversion) if resolveDefault() hasn't
  // run yet — App.tsx calls it synchronously right after sign-in, so in
  // practice this only matters for one render before it resolves.
  const unitSystem = useUnitStore((s) => s.unitSystem) ?? 'imperial'
  // 'reps'/'in' exercises (bodyweight counts, box heights) aren't a weight
  // at all — never converted regardless of the active unit system.
  const convertsWeight = isWeightUnit(def.u) && unitSystem === 'metric'
  const increments = INCREMENTS_BY_SYSTEM[unitSystem]

  // Purely optional tag for the set about to be logged — tapping a rep
  // count with nothing selected here logs exactly as before (zero added
  // friction). Resets after every log so a selection never silently
  // carries over and mislabels the next set.
  const [pendingEffort, setPendingEffort] = useState<'e' | 'o' | 'h' | null>(null)

  // openExerciseIndex means "this card is expanded" (accordion state, one
  // card at a time). Whether the rep picker itself is showing is a
  // separate, narrower flag scoped to this one card: every empty set slot
  // logs to the same "next set" regardless of which slot was tapped
  // (logRep always appends), so one boolean is enough — there's never a
  // need to track which slot opened it.
  const [pickerOpen, setPickerOpen] = useState(false)

  // The button grid (repOpts: target ± 4) covers the vast majority of real
  // sets, so a keyboard entry field for the rare custom count (a big AMRAP,
  // or well off target) stays collapsed behind a toggle instead of adding
  // permanent clutter to every open picker.
  const [customOpen, setCustomOpen] = useState(false)
  const [customVal, setCustomVal] = useState('')

  if (!ex) return null
  const last = lastOf(sessions, def.k)
  const full = ex.r.length >= def.s
  const isOpen = openExerciseIndex === index

  const handleLogRep = (v: number) => {
    unlockAudioContext() // must happen inside this click handler, not later, or mobile browsers mute it
    logRep(index, v, pendingEffort)
    setPendingEffort(null)
    setCustomOpen(false)
    setCustomVal('')
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

  const handleCustomSubmit = () => {
    const n = parseInt(customVal, 10)
    if (!Number.isFinite(n) || n <= 0) return
    handleLogRep(n)
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
              {formatLastSets(last, def.u, unitSystem)}
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
          Last: <b>{formatLastSets(last, def.u, unitSystem)}</b> · {ago(last.d)}
        </div>
      ) : (
        <div className={styles.exLast}>First time. Start at the target and see how it moves.</div>
      )}

      <div className={styles.exCue}>{def.cue}</div>

      <div className={styles.stepper}>
        {/* bumpWeight/setWeight always operate on the lb value actually
            stored (draftEx.w) — the increment picked in the current
            display unit is converted to its lb-delta equivalent right
            here, at the call site, rather than changing what gets stored
            in useUIStore's shared weightIncrement. */}
        <button
          className={styles.stepBtn}
          onClick={() => bumpWeight(index, -1, convertsWeight ? toStoredLb(weightIncrement, 'metric') : weightIncrement)}
        >
          −
        </button>
        <div className={styles.stepVal}>
          <input
            className="mono"
            type="number"
            inputMode="decimal"
            value={convertsWeight ? displayWeight(ex.w, 'metric') : ex.w}
            onChange={(e) => {
              const typed = parseFloat(e.target.value) || 0
              setWeight(index, convertsWeight ? toStoredLb(typed, 'metric') : typed)
            }}
            onFocus={(e) => e.target.select()}
          />
          <span className={styles.unit}>
            {convertsWeight ? (def.u === '+lb' ? `EXTRA ${unitLabel('metric')}` : unitLabel('metric')) : def.u === '+lb' ? 'EXTRA LB' : def.u.toUpperCase()}
          </span>
        </div>
        <button
          className={styles.stepBtn}
          onClick={() => bumpWeight(index, 1, convertsWeight ? toStoredLb(weightIncrement, 'metric') : weightIncrement)}
        >
          +
        </button>
      </div>

      <div className={styles.incSel}>
        {increments.map((v) => (
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
            // Every empty slot's tap opens the same picker (logRep always
            // appends), but only the FIRST one — index ex.r.length — is
            // actually what tapping a rep number is about to fill. Flag
            // just that one so the pulse means something specific instead
            // of lighting up every future placeholder at once.
            const isPending = pickerOpen && j === ex.r.length
            return (
              <button key={j} className={`${styles.blk} ${isPending ? styles.pending : ''}`} onClick={() => setPickerOpen(true)}>
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
          {customOpen ? (
            <>
              <input
                className={`${styles.repInput} mono`}
                type="number"
                inputMode="numeric"
                autoFocus
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomSubmit()
                }}
                placeholder="Reps"
              />
              <button className={`${styles.rep} ${styles.tgt}`} onClick={handleCustomSubmit} aria-label="Log custom rep count">
                <CheckIcon size="15px" />
              </button>
            </>
          ) : (
            <>
              {repOpts(def.r).map((v) => (
                <button
                  key={v}
                  className={`${styles.rep} ${v === def.r ? styles.tgt : ''}`}
                  onClick={() => handleLogRep(v)}
                >
                  {v}
                </button>
              ))}
              <button className={`${styles.rep} ${styles.custom}`} onClick={() => setCustomOpen(true)} aria-label="Enter a custom rep count">
                #
              </button>
            </>
          )}
          <button
            className={`${styles.rep} ${styles.x}`}
            onClick={() => {
              setPickerOpen(false)
              setCustomOpen(false)
              setCustomVal('')
            }}
            aria-label="Close rep picker"
          >
            <CloseIcon size="15px" />
          </button>
        </div>
      )}
    </div>
  )
})

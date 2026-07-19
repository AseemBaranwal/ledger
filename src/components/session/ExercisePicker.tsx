import { useMemo, useState } from 'react'
import { useSessionStore, useConfigStore } from '@/store'
import { useCustomExerciseStore } from '@/store/customExerciseStore'
import { lastOf } from '@/services/trendCalculations'
import { alternatesForCode, searchCatalog, toProgramExercise, resolveExerciseDisplay, type MuscleGroup } from '@/services/exerciseCatalog'
import type { ProgramExercise } from '@/types'
import { CloseIcon, SearchIcon } from '@/components/icons/Icons'
import styles from '../../styles/components.module.css'

interface ExercisePickerProps {
  mode: 'swap' | 'add'
  currentCode?: string
  onSelect: (def: ProgramExercise, startWeight: number) => void
  onClose: () => void
}

interface ResultRow {
  key: string
  label: string
  sub: string
  def: ProgramExercise
}

const GROUP_CHIPS: MuscleGroup[] = ['Legs', 'Push', 'Pull', 'Sprint']

export function ExercisePicker({ mode, currentCode, onSelect, onClose }: ExercisePickerProps) {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const colours = useConfigStore((s) => s.colours)
  const customExercises = useCustomExerciseStore((s) => s.customExercises)
  const registerCustom = useCustomExerciseStore((s) => s.registerCustom)

  const [query, setQuery] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)

  const startWeightFor = (code: string, fallback: number): number => {
    const last = lastOf(sessions, code)
    if (!last) return fallback
    return last.ws?.length ? Math.max(...last.ws) : (last.w ?? fallback)
  }

  const toRow = (def: ProgramExercise, subOverride?: string): ResultRow => ({
    key: def.k,
    label: def.n,
    sub: subOverride ?? def.group,
    def,
  })

  const alternates = useMemo(() => {
    if (mode !== 'swap' || !currentCode) return []
    return alternatesForCode(currentCode).map((a) => toRow(toProgramExercise(a.type), 'Alternate · ' + a.group))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentCode])

  const recentlyUsed = useMemo(() => {
    const seen = new Set<string>()
    const rows: ResultRow[] = []
    for (let i = sessions.length - 1; i >= 0 && rows.length < 8; i--) {
      for (const e of sessions[i].ex || []) {
        if (seen.has(e.k) || e.k === currentCode) continue
        seen.add(e.k)
        const display = resolveExerciseDisplay(e.k, program, colours, customExercises)
        rows.push(toRow(toProgramExercise(e.k, { n: display.name, group: display.group }), display.group))
      }
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, program, colours, customExercises, currentCode])

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const rows: ResultRow[] = []
    const seenKeys = new Set<string>()

    // Already-programmed exercises (lets you pull in a lift from elsewhere
    // in the split, e.g. borrowing a Pull exercise mid-Push day).
    Object.values(program).forEach((p) =>
      p.ex.forEach((e) => {
        if (seenKeys.has(e.k) || e.k === currentCode) return
        if (e.n.toLowerCase().includes(q)) {
          seenKeys.add(e.k)
          rows.push(toRow({ ...e, n: e.n.replace(' ★', '') }, e.group))
        }
      })
    )

    // Previously-used custom exercises — surfaced before a fresh catalog
    // search so re-typing something you've already logged reuses the same
    // entry instead of silently forking into a near-duplicate.
    Object.entries(customExercises).forEach(([k, entry]) => {
      if (seenKeys.has(k) || k === currentCode) return
      if (entry.n.toLowerCase().includes(q)) {
        seenKeys.add(k)
        rows.push(toRow(toProgramExercise(k, { n: entry.n, group: entry.group, u: entry.u }), 'Custom · ' + entry.group))
      }
    })

    searchCatalog(query, 30).forEach((c) => {
      if (seenKeys.has(c.type) || c.type === currentCode) return
      seenKeys.add(c.type)
      rows.push(toRow(toProgramExercise(c.type), c.group))
    })

    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, program, customExercises, currentCode])

  const handlePick = (def: ProgramExercise) => {
    onSelect(def, startWeightFor(def.k, def.w))
  }

  const handleAddCustom = (group: MuscleGroup) => {
    const def = registerCustom(query.trim(), group)
    onSelect(def, 0)
  }

  const showAlternates = !query.trim() && alternates.length > 0
  const showRecent = !query.trim() && recentlyUsed.length > 0
  const showSearch = query.trim().length > 0

  return (
    <div className={styles.pickerOverlay} onClick={onClose}>
      <div className={styles.pickerSheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.pickerHead}>
          <h2>{mode === 'swap' ? 'Swap exercise' : 'Add exercise'}</h2>
          <button className={styles.pickerClose} onClick={onClose} title="Close">
            <CloseIcon size="16px" />
          </button>
        </div>

        <div className={styles.pickerSearchWrap}>
          <span className={styles.pickerSearchIcon}>
            <SearchIcon />
          </span>
          <input
            className={styles.pickerSearchInput}
            placeholder="Search exercises…"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value)
              setAddingCustom(false)
            }}
          />
        </div>

        <div className={styles.pickerScroll}>
          {showAlternates && (
            <>
              <div className={styles.pickerSectionLabel}>Compatible alternates</div>
              {alternates.map((row) => (
                <PickerRow key={row.key} row={row} onPick={handlePick} />
              ))}
            </>
          )}

          {showRecent && (
            <>
              <div className={styles.pickerSectionLabel}>Recently logged</div>
              {recentlyUsed.map((row) => (
                <PickerRow key={row.key} row={row} onPick={handlePick} />
              ))}
            </>
          )}

          {showSearch && (
            <>
              <div className={styles.pickerSectionLabel}>{searchResults.length ? 'Results' : 'No matches'}</div>
              {searchResults.map((row) => (
                <PickerRow key={row.key} row={row} onPick={handlePick} />
              ))}

              {!addingCustom ? (
                <button className={styles.pickerAddCustom} onClick={() => setAddingCustom(true)}>
                  Can't find it? Add "{query.trim()}" as custom
                </button>
              ) : (
                <div className={styles.pickerGroupChips}>
                  <div className={styles.pickerSectionLabel}>Which muscle group?</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {GROUP_CHIPS.map((g) => (
                      <button key={g} className={styles.pickerChip} onClick={() => handleAddCustom(g)}>
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!showAlternates && !showRecent && !showSearch && (
            <div className={styles.pickerSectionLabel}>Start typing to search Strava's exercise catalog</div>
          )}
        </div>
      </div>
    </div>
  )
}

function PickerRow({ row, onPick }: { row: ResultRow; onPick: (def: ProgramExercise) => void }) {
  return (
    <button className={styles.pickerRow} onClick={() => onPick(row.def)}>
      <span className={styles.pickerRowMain}>{row.label}</span>
      <span className={styles.pickerRowSub}>{row.sub}</span>
    </button>
  )
}

import { useMemo, useState, useEffect } from 'react'
import { useSessionStore, useConfigStore } from '@/store'
import { useCustomExerciseStore } from '@/store/customExerciseStore'
import { lastOf } from '@/services/trendCalculations'
import { alternatesForCode, searchCatalog, toProgramExercise, resolveExerciseDisplay, equipmentForCode, type MuscleGroup, type Equipment } from '@/services/exerciseCatalog'
import type { ProgramExercise } from '@/types'
import { CloseIcon, SearchIcon } from '@/components/icons/Icons'
import { EquipmentIcon } from '@/components/icons/EquipmentIcon'
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
  equipment: Equipment
}

const GROUP_CHIPS: MuscleGroup[] = ['Legs', 'Push', 'Pull', 'Sprint']

// Same order as the equipment reference sheet — commonest gym equipment
// first, Bodyweight last as the "needs nothing" option.
const EQUIPMENT_CHIPS: Equipment[] = [
  'Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell', 'Box',
  'Band', 'Plate', 'Rings', 'MedicineBall', 'StabilityBall', 'Bodyweight',
]

const EQUIPMENT_LABEL: Record<Equipment, string> = {
  Barbell: 'Barbell',
  Dumbbell: 'Dumbbell',
  Machine: 'Machine',
  Cable: 'Cable',
  Kettlebell: 'Kettlebell',
  Box: 'Box',
  Band: 'Band',
  Plate: 'Plate',
  Rings: 'Rings',
  MedicineBall: 'Med ball',
  StabilityBall: 'Stability ball',
  Bodyweight: 'Bodyweight',
}

export function ExercisePicker({ mode, currentCode, onSelect, onClose }: ExercisePickerProps) {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const colours = useConfigStore((s) => s.colours)
  const customExercises = useCustomExerciseStore((s) => s.customExercises)
  const registerCustom = useCustomExerciseStore((s) => s.registerCustom)

  const [query, setQuery] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  const [equipmentFilter, setEquipmentFilter] = useState<Equipment | null>(null)

  // The search input autofocuses on open, but there was previously no way
  // to close this modal from the keyboard at all besides tabbing to the
  // small close button.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

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
    equipment: equipmentForCode(def.k),
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

  const byEquipment = (rows: ResultRow[]): ResultRow[] =>
    equipmentFilter ? rows.filter((r) => r.equipment === equipmentFilter) : rows

  const filteredAlternates = byEquipment(alternates)
  const filteredRecentlyUsed = byEquipment(recentlyUsed)
  const filteredSearchResults = byEquipment(searchResults)

  const showAlternates = !query.trim() && filteredAlternates.length > 0
  const showRecent = !query.trim() && filteredRecentlyUsed.length > 0
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

        <div className={styles.equipmentChipsWrap}>
          <div className={styles.equipmentChips}>
            {EQUIPMENT_CHIPS.map((eq) => (
              <button
                key={eq}
                className={`${styles.equipmentChip} ${equipmentFilter === eq ? styles.on : ''}`}
                onClick={() => setEquipmentFilter(equipmentFilter === eq ? null : eq)}
              >
                <EquipmentIcon equipment={eq} size="14px" />
                {EQUIPMENT_LABEL[eq]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.pickerScroll}>
          {showAlternates && (
            <>
              <div className={styles.pickerSectionLabel}>Compatible alternates</div>
              {filteredAlternates.map((row) => (
                <PickerRow key={row.key} row={row} onPick={handlePick} />
              ))}
            </>
          )}

          {showRecent && (
            <>
              <div className={styles.pickerSectionLabel}>Recently logged</div>
              {filteredRecentlyUsed.map((row) => (
                <PickerRow key={row.key} row={row} onPick={handlePick} />
              ))}
            </>
          )}

          {showSearch && (
            <>
              <div className={styles.pickerSectionLabel}>{filteredSearchResults.length ? 'Results' : 'No matches'}</div>
              {filteredSearchResults.map((row) => (
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
      <span className={styles.pickerRowMain}>
        <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--dim)' }}>
          <EquipmentIcon equipment={row.equipment} size="21px" />
        </span>
        {row.label}
      </span>
      <span className={styles.pickerRowSub}>{row.sub}</span>
    </button>
  )
}

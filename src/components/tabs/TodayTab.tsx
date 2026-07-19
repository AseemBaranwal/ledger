import { useState, useEffect } from 'react'
import { useSessionStore, useConfigStore, useUIStore } from '@/store'
import { ExerciseLogger, ExercisePicker } from '@/components/session'
import { iso, mondayOf } from '@/services/dateUtils'
import { toProgramExercise, type MuscleGroup } from '@/services/exerciseCatalog'
import type { ProgramExercise, RestDayConfig } from '@/types'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'
import { StarIcon, CheckIcon, ChevronIcon, PlusIcon } from '@/components/icons/Icons'

const DOW_LABEL: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

function tgtStr(e: ProgramExercise): string {
  let t = `${e.s}×${e.r}`
  if (e.w > 0) t += e.u === '+lb' ? ` · +${e.w} lb` : ` · ${e.w} ${e.u === 'reps' ? '' : e.u}`.trimEnd()
  return t
}

export function TodayTab() {
  const draft = useSessionStore((s) => s.draft)
  const draftEx = useSessionStore((s) => s.draftEx)
  const draftDefs = useSessionStore((s) => s.draftDefs)
  const draftItems = useSessionStore((s) => s.draftItems)
  const sessions = useSessionStore((s) => s.sessions)
  const startSession = useSessionStore((s) => s.startSession)
  const startRestSession = useSessionStore((s) => s.startRestSession)
  const toggleRestItem = useSessionStore((s) => s.toggleRestItem)
  const setRestItemDuration = useSessionStore((s) => s.setRestItemDuration)
  const updateNotes = useSessionStore((s) => s.updateNotes)
  const saveDraft = useSessionStore((s) => s.saveDraft)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const swapExercise = useSessionStore((s) => s.swapExercise)
  const addExercise = useSessionStore((s) => s.addExercise)
  const removeExercise = useSessionStore((s) => s.removeExercise)
  const hydrateDraftDefs = useSessionStore((s) => s.hydrateDraftDefs)

  const program = useConfigStore((s) => s.program)
  const restDays = useConfigStore((s) => s.restDays)
  const colours = useConfigStore((s) => s.colours)
  const schedule = useConfigStore((s) => s.schedule)
  const substitutions = useConfigStore((s) => s.substitutions)

  const openWeekDay = useUIStore((s) => s.openWeekDay)
  const toggleWeekDay = useUIStore((s) => s.toggleWeekDay)
  const setOpenExerciseIndex = useUIStore((s) => s.setOpenExerciseIndex)

  const [today] = useState(new Date())
  const [picker, setPicker] = useState<{ mode: 'swap' | 'add'; index?: number } | null>(null)
  const dayOfWeek = today.getDay()
  const weekDays = schedule.weekDays.length ? schedule.weekDays : [1, 2, 3, 4, 5, 6, 0]
  const priority = schedule.priority

  const codesForDay = (dow: number) => Object.keys(program).filter((k) => program[k].day === dow)

  // A Coach-accepted swap (see chatStore.acceptSwap) is a standing
  // substitution keyed by the ORIGINAL code — applied here so the week
  // preview and the actually-started session always show the same
  // exercise, not the preview showing the original while the started
  // session shows the swap.
  const withSubstitutions = (exList: ProgramExercise[]): ProgramExercise[] =>
    exList.map((e) => {
      const sub = substitutions[e.k]
      if (!sub) return e
      return toProgramExercise(sub.code, { n: sub.name, group: sub.group as MuscleGroup, u: sub.unit, s: e.s, r: e.r })
    })

  const doneThisWeek = (): Set<string> => {
    const mon = mondayOf(new Date())
    const sun = new Date(mon)
    sun.setDate(sun.getDate() + 6)
    const sunStr = iso(sun)
    const set = new Set<string>()
    sessions.forEach((x) => {
      if (x.d >= mon && x.d <= sunStr && x.s) set.add(x.s)
    })
    return set
  }

  const owedThisWeek = (): string[] => {
    const done = doneThisWeek()
    const todayPos = weekDays.indexOf(dayOfWeek)
    return priority.filter((k) => program[k] && weekDays.indexOf(program[k].day) <= todayPos && !done.has(k))
  }

  const handleStart = (code: string) => {
    const p = program[code]
    const defs = withSubstitutions(p.ex)
    startSession(
      code,
      defs.map((e) => {
        // start at the last logged weight, or the config default
        const last = sessions.length
          ? [...sessions].reverse().flatMap((s) => s.ex || []).find((x) => x.k === e.k)
          : null
        return { k: e.k, w: last?.w != null ? last.w : e.w }
      }),
      p.gym,
      defs
    )
    setOpenExerciseIndex(null)
    useUIStore.setState({ openWeekDay: null })
  }

  const handleStartRest = (dow: number) => {
    const r = restDays[dow] || { t: 'Rest', s: '', items: [] }
    startRestSession(dow, r.t, r.items || [])
  }

  // "Start X" is usually clicked from deep inside an expanded day mid-page —
  // without this the logging view renders at whatever scroll position the
  // overview happened to be at, landing the user in the middle of the page.
  useEffect(() => {
    if (draft) window.scrollTo(0, 0)
  }, [draft?.s, draft?.type])

  // Backfills draftDefs for a session that was already in progress when the
  // swap/add-exercise feature shipped (draftDefs didn't exist yet) — the
  // static program list is still accurate for an old draft since nothing
  // could have been swapped before this code existed. No-ops once
  // draftDefs is already populated.
  useEffect(() => {
    if (draft && draft.type === 'PROGRAM' && draftEx && !draftDefs) {
      const p = program[draft.s!]
      if (p) hydrateDraftDefs(p.ex)
    }
  }, [draft, draftEx, draftDefs, program, hydrateDraftDefs])

  // ─── WEEK CARD ───
  const done = doneThisWeek()
  const owed = owedThisWeek()

  const weekCard = (
    <div className={styles.wkCard}>
      <div className={styles.wkHead}>
        <h2>This week</h2>
        <div className={styles.rule} />
      </div>
      {weekDays.map((dow) => {
        const codes = codesForDay(dow)
        const isToday = dow === dayOfWeek
        const isOpen = openWeekDay === dow
        let detail = ''

        if (!codes.length) {
          const r = restDays[dow]
          if (isToday && r) detail = r.s
        }

        return (
          <div key={dow}>
            <div
              className={`${styles.wkRow} ${isToday ? styles.now : ''} ${isOpen ? styles.open : ''}`}
              onClick={() => toggleWeekDay(dow)}
            >
              <span className={styles.wkDay}>
                {DOW_LABEL[dow]}{isToday ? ' · today' : ''}
              </span>
              <span className={styles.wkBody}>
                {codes.length ? (
                  codes.map((c) => {
                    const p = program[c]
                    const col = colours[p.colour] || 'var(--dim)'
                    const ok = done.has(c)
                    return (
                      <span key={c} className={`${styles.wkItem} ${ok ? styles.ok : ''}`}>
                        <span className={styles.wkDot} style={{ background: col }} />
                        {p.name}
                        {ok ? (
                          <span className={styles.wkCheck}>
                            {' '}
                            <CheckIcon />
                          </span>
                        ) : null}
                      </span>
                    )
                  })
                ) : (
                  <span className={`${styles.wkItem} ${styles.rest}`}>
                    <span className={styles.wkDot} style={{ background: schedule.restColour[dow] || 'var(--line-2)' }} />
                    {restDays[dow]?.t || 'Rest'}
                  </span>
                )}
                {detail && <span className={styles.wkDetail}>{detail}</span>}
              </span>
              <span className={styles.wkChev}>
                <ChevronIcon open={isOpen} />
              </span>
            </div>
            {isOpen && (
              <div className={styles.wkExpand}>
                {codes.length ? (
                  codes.map((c) => {
                    const p = program[c]
                    const col = colours[p.colour] || 'var(--dim)'
                    return (
                      <div key={c} className={styles.wdSess} style={{ boxShadow: `inset 2px 0 0 ${col}` }}>
                        <div className={styles.wdH}>
                          {p.full}
                          <span className={`${styles.wdGym} mono`}>{p.gym}</span>
                        </div>
                        {withSubstitutions(p.ex).map((e) => {
                          const last = [...sessions].reverse().flatMap((s) => (s.ex || []).map((x) => ({ ...x, d: s.d }))).find((x) => x.k === e.k && x.r.length)
                          const lastStr = last
                            ? `Last ${last.ws ? last.ws.join(',') : last.w}${e.u === '+lb' ? '+' : ''}×${last.r.join(',')}`
                            : 'First time — start at target'
                          return (
                            <div key={e.k} className={styles.wdEx}>
                              <div className={styles.wdExh}>
                                <span className={styles.wdName}>
                                  {e.n.includes('★') ? (
                                    <>
                                      {e.n.replace('★', '')}
                                      <span className={styles.star}>
                                        {' '}
                                        <StarIcon />
                                      </span>
                                    </>
                                  ) : e.n}
                                </span>
                                <span className={`${styles.wdTgt} mono`}>{tgtStr(e)}</span>
                              </div>
                              <div className={`${styles.wdLast} mono`}>{lastStr}</div>
                              <div className={styles.wdCue}>{e.cue}</div>
                            </div>
                          )
                        })}
                        <button className={styles.wdStart} onClick={() => handleStart(c)}>
                          Start {p.name} →
                        </button>
                      </div>
                    )
                  })
                ) : restDays[dow]?.items ? (
                  <div className={styles.wdSess}>
                    {restDays[dow].items.map((it, i) => (
                      <div key={i} className={styles.wdEx}>
                        <div className={styles.wdExh}>
                          <span className={styles.wdName}>{it.n}</span>
                          <span className={`${styles.wdTgt} mono`}>{it.d}</span>
                        </div>
                        <div className={styles.wdCue}>{(it as any).cue}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.wdSess}>
                    <div className={styles.wdEx}>
                      <div className={styles.wdCue}>Nothing scheduled — full rest.</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {owed.length ? (
        <div className={styles.wkOwed}>
          <span className={styles.wkOwedLbl}>Still owed this week</span>
          {owed.map((c) => {
            const p = program[c]
            return (
              <button key={c} className={styles.wkOwedBtn} onClick={() => handleStart(c)}>
                <span className={styles.wkDot} style={{ background: colours[p.colour] }} />
                {p.full} →
              </button>
            )
          })}
        </div>
      ) : (
        <div className={styles.wkOwed}>
          <span className={`${styles.wkOwedLbl} ${styles.done}`}>All priority lifts hit ✓</span>
        </div>
      )}
    </div>
  )

  // ─── ACTIVE SESSION ───
  if (draft) {
    const isRest = draft.type === 'REST'

    if (isRest && draftItems) {
      return (
        <div>
          <div className={appStyles.hero}>
            <div className={appStyles.eyebrow}>{draft.g}</div>
            <h1>{draft.g}</h1>
          </div>
          {draftItems.map((item, i) => (
            <div key={i} className={`${styles.card} ${item.done ? styles.done : ''}`}>
              <div className={styles.exHead}>
                <div className={styles.exName}>{item.n}</div>
                <div className={`${styles.exTarget} mono`}>
                  <input
                    type="text"
                    style={{ background: 'none', border: 'none', textAlign: 'right', color: 'var(--dim)', width: '80px', padding: 0, fontFamily: 'JetBrains Mono' }}
                    value={item.d}
                    onChange={(e) => setRestItemDuration(i, e.target.value)}
                  />
                </div>
              </div>
              <div style={{ padding: '0 14px 12px' }}>
                <button
                  className={`${styles.btn} ${item.done ? styles.primary : styles.ghost}`}
                  onClick={() => toggleRestItem(i)}
                >
                  {item.done ? '✓ Done' : 'Mark Done'}
                </button>
              </div>
            </div>
          ))}

          <div className={styles.sec}>
            <h2>Notes</h2>
            <div className={styles.rule} />
          </div>
          <textarea
            className={styles.notes}
            placeholder="Form, energy, anything worth remembering."
            value={draft.n || ''}
            onChange={(e) => updateNotes(e.target.value)}
          />
          <div style={{ height: '12px' }} />
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={() => {
              const logged = draftItems.filter((i) => i.done)
              if (!logged.length) return
              saveDraft()
            }}
          >
            Save session
          </button>
          <div style={{ height: '8px' }} />
          <button
            className={`${styles.btn} ${styles.quiet}`}
            onClick={() => {
              if (confirm('Discard this session?')) clearDraft()
            }}
          >
            Discard
          </button>
          <div style={{ height: '20px' }} />
        </div>
      )
    }

    if (!isRest && draftEx) {
      const p = program[draft.s!]
      if (!p) return null
      const col = colours[p.colour] || 'var(--amber)'
      const doneCount = draftEx.filter((e) => e.r.length).length
      const defs = draftDefs ?? p.ex

      return (
        <div>
          <div className={appStyles.hero}>
            <div className={appStyles.eyebrow}>{p?.full}</div>
            <h1 style={{ color: col }}>{p?.name}</h1>
            <div className={appStyles.heroSub}>
              <span className={appStyles.pill} style={{ background: `${col}22`, color: col }}>
                <span className={appStyles.dot} />
                {draft.g}
              </span>
              &nbsp;<span className="mono" style={{ color: 'var(--dim)' }}>{doneCount}/{draftEx.length} exercises</span>
            </div>
          </div>

          {draftEx.map((_, index) => {
            const def = defs[index]
            if (!def) return null
            return (
              <ExerciseLogger
                key={index}
                def={def}
                index={index}
                onRequestSwap={(i) => setPicker({ mode: 'swap', index: i })}
                onRequestRemove={(i) => removeExercise(i)}
              />
            )
          })}

          <button
            className={`${styles.btn} ${styles.ghost}`}
            style={{ marginBottom: '14px' }}
            onClick={() => setPicker({ mode: 'add' })}
          >
            <PlusIcon size="15px" /> Add Exercise
          </button>

          {picker && (
            <ExercisePicker
              mode={picker.mode}
              currentCode={picker.mode === 'swap' && picker.index != null ? defs[picker.index]?.k : undefined}
              onSelect={(def, startWeight) => {
                if (picker.mode === 'swap' && picker.index != null) {
                  swapExercise(picker.index, def, startWeight)
                } else {
                  addExercise(def, startWeight)
                }
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
          )}

          <div className={styles.sec}>
            <h2>Notes</h2>
            <div className={styles.rule} />
          </div>
          <textarea
            className={styles.notes}
            placeholder={`Form, energy, anything worth remembering. Gym if it wasn't ${draft.g}.`}
            value={draft.n || ''}
            onChange={(e) => updateNotes(e.target.value)}
          />
          <div style={{ height: '12px' }} />
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={() => {
              const logged = draftEx.filter((e) => e.r.length)
              if (!logged.length) return
              saveDraft()
            }}
          >
            Save session
          </button>
          <div style={{ height: '8px' }} />
          <button
            className={`${styles.btn} ${styles.quiet}`}
            onClick={() => {
              if (confirm('Discard this session?')) clearDraft()
            }}
          >
            Discard
          </button>
          <div style={{ height: '20px' }} />
        </div>
      )
    }
  }

  // ─── OVERVIEW ───
  const codes = codesForDay(dayOfWeek)
  const dstr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  if (!codes.length) {
    const r: RestDayConfig = restDays[dayOfWeek] || { t: 'Rest', s: 'Nothing scheduled.', items: [] }
    return (
      <div>
        <div className={appStyles.hero}>
          <div className={appStyles.eyebrow}>{dstr}</div>
          <h1>{r.t}</h1>
          <div className={appStyles.heroSub}>{r.s}</div>
        </div>
        {weekCard}
        {r.items?.length ? (
          <>
            <div className={styles.sec}>
              <h2>Today's Plan</h2>
              <div className={styles.rule} />
            </div>
            {r.items.map((it, i) => (
              <div key={i} className={styles.restCard}>
                <div className={styles.restHead}>
                  <span className={styles.restName}>{it.n}</span>
                  <span className={`${styles.restDur} mono`}>{it.d}</span>
                </div>
                <div className={styles.restCue}>{(it as any).cue}</div>
              </div>
            ))}
            <button
              className={`${styles.btn} ${styles.primary}`}
              style={{ marginBottom: '8px' }}
              onClick={() => handleStartRest(dayOfWeek)}
            >
              {r.items.length > 1 ? `Start ${r.t}` : `Start ${r.items[0].n}`}
            </button>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>{dstr}</div>
        <h1>
          {codes.map((c, i) => (
            <span key={c}>
              <span className={appStyles.accent}>{program[c].name}</span>
              {i < codes.length - 1 ? ' + ' : ''}
            </span>
          ))}
        </h1>
        <div className={appStyles.heroSub}>{codes.map((c) => program[c].full).join('  ·  ')}</div>
      </div>
      {weekCard}
      {codes.map((c) => (
        <button key={c} className={`${styles.btn} ${styles.primary}`} style={{ marginBottom: '8px' }} onClick={() => handleStart(c)}>
          Start {program[c].name}
        </button>
      ))}
      <div className={styles.sec}>
        <h2>Or log a different session</h2>
        <div className={styles.rule} />
      </div>
      {Object.keys(program)
        .filter((k) => !codes.includes(k))
        .map((k) => (
          <button key={k} className={`${styles.btn} ${styles.quiet}`} style={{ marginBottom: '7px' }} onClick={() => handleStart(k)}>
            {program[k].full}
          </button>
        ))}
    </div>
  )
}

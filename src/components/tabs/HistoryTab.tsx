import { useSessionStore, useUIStore, useConfigStore } from '@/store'
import { useCustomExerciseStore } from '@/store/customExerciseStore'
import { iso, fmtD } from '@/services/dateUtils'
import { volume } from '@/services/trendCalculations'
import { resolveExerciseDisplay } from '@/services/exerciseCatalog'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

export function HistoryTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const colours = useConfigStore((s) => s.colours)
  const customExercises = useCustomExerciseStore((s) => s.customExercises)
  const expandedRow = useUIStore((s) => s.expandedHistoryRow)
  const toggleExpand = useUIStore((s) => s.toggleExpandHistory)

  if (!sessions.length) {
    return (
      <div>
        <div className={appStyles.hero}>
          <div className={appStyles.eyebrow}>Everything you've logged</div>
          <h1>History</h1>
        </div>
        <div className="empty">
          <div className="big">Nothing logged yet</div>
          <div className="sm">Finish a session on the Today tab and it lands here.</div>
        </div>
      </div>
    )
  }

  const byWeek: Record<string, typeof sessions> = {}
  ;[...sessions].reverse().forEach((s) => {
    const d = new Date(s.d + 'T12:00')
    const m = new Date(d)
    m.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const key = iso(m)
    ;(byWeek[key] = byWeek[key] || []).push(s)
  })

  return (
    <div>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Everything you've logged</div>
        <h1>History</h1>
      </div>

      {Object.entries(byWeek).map(([wk, ss]) => {
        const vol = ss.reduce((t, s) => t + volume(s), 0)
        return (
          <div key={wk}>
            <div className={styles.sec}>
              <h2>Week of {fmtD(wk).replace(/^\w+, /, '')}</h2>
              <div className={styles.rule} />
              <div className={`${styles.cnt} mono`}>
                {ss.length} session{ss.length > 1 ? 's' : ''} · {Math.round(vol / 1000)}k lb
              </div>
            </div>
            {ss.map((s) => {
              // REST sessions (Skating, Easy Run + Core, Full Rest — see
              // sessionStore's startRestSession) aren't in `program` at all
              // (that's PROGRAM-only), so the old single fallback name
              // `s.s || 'REST'` rendered the raw internal code (e.g.
              // "REST_5") as the title once these actually started showing
              // up in History. The real title was there the whole time, on
              // `s.g` (startRestSession stores it there, not on the `t`
              // field the Session type suggests).
              const isRest = s.type === 'REST'
              const p = program[s.s || ''] || { name: s.g || 'Rest Day', colour: 'legs', full: '', gym: '', day: 0, ex: [] }
              const title = isRest ? s.g || 'Rest Day' : p.name
              const id = s.d + s.s
              const sets = (s.ex || []).reduce((t, e) => t + e.r.length, 0)
              const doneItems = (s.items || []).filter((it) => it.done).length
              const vol = volume(s)
              const isOpen = expandedRow === id
              return (
                <div key={id}>
                  <button
                    className={styles.hrow}
                    onClick={() => toggleExpand(id)}
                    aria-expanded={isOpen}
                  >
                    <div className={styles.bar} style={{ background: isRest ? 'var(--dim)' : colours[p.colour] || 'var(--dim)' }} />
                    <div className={styles.m}>
                      <div className={styles.t}>{title}</div>
                      <div className={`${styles.s} mono`}>
                        {isRest
                          ? `${fmtD(s.d)} · ${doneItems}/${(s.items || []).length} done`
                          : `${fmtD(s.d)} · ${s.g || ''} · ${sets} set${sets === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    {/* Sprint sessions log a "weight" field that's actually
                        something else (e.g. incline/speed, confirmed by
                        checking the real data: SPR logged ws:[5] for 6
                        reps — 5 isn't lb), so their "volume" is a
                        meaningless small number, not zero — a vol>0 check
                        alone doesn't catch it. Gate on session type
                        instead of the number: real lb volume only exists
                        for actual weight-training colours. */}
                    {!isRest && p.colour !== 'sprint' && vol > 0 && (
                      <div className={`${styles.v} mono`}>
                        <b>{(vol / 1000).toFixed(1)}k</b>lb vol
                      </div>
                    )}
                  </button>
                  <div className={`${styles.hdetail} ${isOpen ? styles.on : ''}`}>
                    {isRest
                      ? (s.items || []).map((it, i) => (
                          <div key={i} className={styles.ln}>
                            <span className={styles.k}>
                              {it.done ? '✓ ' : ''}
                              {it.n}
                            </span>
                            <span>{it.d}</span>
                          </div>
                        ))
                      : (s.ex || []).map((e) => {
                          const effortCls = (v: 'e' | 'o' | 'h') => (v === 'e' ? styles.easy : v === 'o' ? styles.ok : styles.hard)
                          return (
                            <div key={e.k} className={styles.ln}>
                              <span className={styles.k}>{resolveExerciseDisplay(e.k, program, colours, customExercises).name}</span>
                              <span>
                                {e.r.map((r, i) => {
                                  const w = e.ws ? e.ws[i] : e.w
                                  const effort = e.ef?.[i]
                                  return (
                                    <span key={i}>
                                      {i > 0 && ', '}
                                      {w || 'BW'}×{r}
                                      {effort && <span className={`${styles.effDotInline} ${effortCls(effort)}`} />}
                                    </span>
                                  )
                                })}
                              </span>
                            </div>
                          )
                        })}
                    {s.n && (
                      <div style={{ paddingTop: '8px', color: 'var(--dim)', fontFamily: 'Inter', fontSize: '12px' }}>
                        "{s.n}"
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
      <div style={{ height: '20px' }} />
    </div>
  )
}

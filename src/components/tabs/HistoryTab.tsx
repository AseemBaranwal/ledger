import { useSessionStore, useUIStore, useConfigStore } from '@/store'
import { iso, fmtD } from '@/services/dateUtils'
import { volume } from '@/services/trendCalculations'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

export function HistoryTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const colours = useConfigStore((s) => s.colours)
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
              const p = program[s.s || ''] || { name: s.s || 'REST', colour: 'legs', full: '', gym: '', day: 0, ex: [] }
              const id = s.d + s.s
              const sets = (s.ex || []).reduce((t, e) => t + e.r.length, 0)
              const isOpen = expandedRow === id
              return (
                <div key={id}>
                  <div className={styles.hrow} onClick={() => toggleExpand(id)}>
                    <div className={styles.bar} style={{ background: colours[p.colour] || 'var(--dim)' }} />
                    <div className={styles.m}>
                      <div className={styles.t}>{p.name}</div>
                      <div className={`${styles.s} mono`}>
                        {fmtD(s.d)} · {s.g || ''} · {sets} sets
                      </div>
                    </div>
                    <div className={`${styles.v} mono`}>
                      <b>{(volume(s) / 1000).toFixed(1)}k</b>lb vol
                    </div>
                  </div>
                  <div className={`${styles.hdetail} ${isOpen ? styles.on : ''}`}>
                    {(s.ex || []).map((e) => {
                      const def = program[s.s || '']?.ex?.find((x) => x.k === e.k)
                      const setsStr = e.r
                        .map((r, i) => {
                          const w = e.ws ? e.ws[i] : e.w
                          return `${w || 'BW'}×${r}`
                        })
                        .join(', ')
                      return (
                        <div key={e.k} className={styles.ln}>
                          <span className={styles.k}>{def ? def.n.replace(' ★', '') : e.k}</span>
                          <span>{setsStr}</span>
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

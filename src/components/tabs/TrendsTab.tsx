import { useSessionStore, useConfigStore, useUIStore } from '@/store'
import { useCustomExerciseStore } from '@/store/customExerciseStore'
import { iso, fmtD, ago } from '@/services/dateUtils'
import { streak } from '@/services/trendCalculations'
import { resolveExerciseDisplay } from '@/services/exerciseCatalog'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

interface LinePt { v: number; l: string }
interface BarPt { l: string; v: number }

function LineChart({ pts, colour, h = 130 }: { pts: LinePt[]; colour: string; h?: number }) {
  if (pts.length < 2) {
    return (
      <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: 13 }}>
        Need at least 2 data points
      </div>
    )
  }
  const W = 320, H = h, pad = { t: 14, r: 8, b: 20, l: 8 }
  const ys = pts.map((p) => p.v)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const span = y1 - y0 || 1
  const lo = y0 - span * 0.18, hi = y1 + span * 0.18
  const X = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r)
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('')
  const area = `${d}L${X(pts.length - 1).toFixed(1)},${H - pad.b}L${X(0).toFixed(1)},${H - pad.b}Z`
  const gid = 'g' + Math.random().toString(36).slice(2, 7)

  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity={0.26} />
          <stop offset="100%" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={X(i)}
          cy={Y(p.v)}
          r={i === pts.length - 1 ? 3.6 : 2.2}
          fill={i === pts.length - 1 ? colour : 'var(--ink)'}
          stroke={colour}
          strokeWidth={1.6}
        />
      ))}
      <text x={pad.l} y={H - 5} fill="#5A6572" fontSize={9} fontFamily="JetBrains Mono">{pts[0].l}</text>
      <text x={W - pad.r} y={H - 5} fill="#5A6572" fontSize={9} fontFamily="JetBrains Mono" textAnchor="end">{pts[pts.length - 1].l}</text>
    </svg>
  )
}

function BarChart({ pts, colour, h = 110 }: { pts: BarPt[]; colour: string; h?: number }) {
  if (!pts.length) return null
  const W = 320, H = h, pad = { t: 12, b: 20 }
  const mx = Math.max(...pts.map((p) => p.v), 1)
  const bw = (W / pts.length) * 0.62
  const gap = (W / pts.length) * 0.38
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: h }}>
      {pts.map((p, i) => {
        const bh = Math.max(2, (p.v / mx) * (H - pad.t - pad.b))
        const x = i * (bw + gap) + gap / 2
        return (
          <g key={i}>
            <rect x={x.toFixed(1)} y={(H - pad.b - bh).toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)} rx={3} fill={p.v >= 3 ? colour : '#3A4552'} />
            <text x={(x + bw / 2).toFixed(1)} y={H - 6} fill="#5A6572" fontSize={8.5} fontFamily="JetBrains Mono" textAnchor="middle">{p.l}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function TrendsTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const colours = useConfigStore((s) => s.colours)
  const customExercises = useCustomExerciseStore((s) => s.customExercises)
  const selectedGroup = useUIStore((s) => s.selectedTrendGroup)
  const setTrendGroup = useUIStore((s) => s.setTrendGroup)

  if (sessions.length < 1) {
    return (
      <div>
        <div className={appStyles.hero}>
          <div className={appStyles.eyebrow}>Is the number going up</div>
          <h1>Trends</h1>
        </div>
        <div className="empty">
          <div className="big">No trends yet</div>
          <div className="sm">Log two sessions of the same lift and the line appears.</div>
        </div>
      </div>
    )
  }

  const allK = [...new Set(sessions.flatMap((s) => (s.ex || []).map((e) => e.k)))]

  // Resolves display info for ANY exercise code — a programmed one, one
  // picked from Strava's catalog via the swap/add picker, or a fully
  // custom one-off — so trends look equally polished regardless of source.
  const nameOf = (k: string): string => resolveExerciseDisplay(k, program, colours, customExercises).name
  const groupOf = (k: string): string => resolveExerciseDisplay(k, program, colours, customExercises).group
  const colOf = (k: string): string => resolveExerciseDisplay(k, program, colours, customExercises).colour

  const allGroups = [...new Set(allK.map(groupOf))]
  const trendGroup = allGroups.includes(selectedGroup) ? selectedGroup : allGroups[0]
  const groupExercises = allK.filter((k) => groupOf(k) === trendGroup)

  // weekly consistency, last 8 weeks
  const wk: Record<string, number> = {}
  sessions.forEach((s) => {
    const d = new Date(s.d + 'T12:00')
    const m = new Date(d)
    m.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    wk[iso(m)] = (wk[iso(m)] || 0) + 1
  })
  const weeks: BarPt[] = []
  const now = new Date()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  for (let i = 7; i >= 0; i--) {
    const w = new Date(mon)
    w.setDate(mon.getDate() - i * 7)
    weeks.push({ l: `${w.getMonth() + 1}/${w.getDate()}`, v: wk[iso(w)] || 0 })
  }

  // volume by group (set count), last 4 weeks
  const cut = iso(new Date(Date.now() - 28 * 864e5))
  const grp: Record<string, number> = { legs: 0, push: 0, pull: 0, sprint: 0 }
  sessions.filter((s) => s.d >= cut).forEach((s) => {
    const c = program[s.s || '']?.colour
    if (c != null) grp[c] = (grp[c] || 0) + (s.ex || []).reduce((t, e) => t + e.r.length, 0)
  })
  const gtot = Object.values(grp).reduce((a, b) => a + b, 0) || 1

  return (
    <div>
      <div className={appStyles.hero}>
        <div className={appStyles.eyebrow}>Is the number going up</div>
        <h1>Trends</h1>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <div className={styles.l}>Sessions</div>
          <div className={`${styles.v} mono`}>{sessions.length}</div>
          <div className={`${styles.d} mono`}>{sessions.length ? ago(sessions[sessions.length - 1].d) : '—'} last</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.l}>Week streak</div>
          <div className={`${styles.v} mono`} style={{ color: 'var(--amber)' }}>{streak(sessions)}</div>
          <div className={`${styles.d} mono`}>3+ sessions/wk</div>
        </div>
      </div>

      <select className={styles.pick} value={trendGroup} onChange={(e) => setTrendGroup(e.target.value)}>
        {allGroups.map((g) => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>

      {groupExercises.map((k) => {
        const pts = sessions
          .filter((s) => (s.ex || []).some((e) => e.k === k))
          .map((s) => {
            const e = s.ex!.find((x) => x.k === k)!
            const w = e.ws ? Math.max(...e.ws) : e.w || 0
            return { v: w, l: fmtD(s.d).replace(/^\w+, /, '') }
          })
        const dl = pts.length > 1 ? pts[pts.length - 1].v - pts[0].v : 0
        const dcls = dl > 0 ? styles.up : dl < 0 ? styles.dn : styles.flat

        return (
          <div key={k} className={styles.chartCard}>
            <div className={styles.chartHd}>
              <h3>{nameOf(k)}</h3>
              <span className={`${styles.delta} ${dcls}`}>{dl > 0 ? '+' : ''}{dl} lb</span>
            </div>
            <div className={styles.chartSub}>
              {pts.length} session{pts.length > 1 ? 's' : ''} · now {pts.length ? pts[pts.length - 1].v : '—'} lb
            </div>
            <LineChart pts={pts} colour={colOf(k)} />
          </div>
        )
      })}

      <div className={styles.chartCard}>
        <div className={styles.chartHd}>
          <h3>Consistency</h3>
          <span className={`${styles.delta} ${weeks[weeks.length - 1].v >= 3 ? styles.up : styles.dn}`}>
            {weeks[weeks.length - 1].v} this wk
          </span>
        </div>
        <div className={styles.chartSub}>Sessions per week · bar goes solid at 3+</div>
        <BarChart pts={weeks} colour="#FFB020" />
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartHd}>
          <h3>Where the work went</h3>
        </div>
        <div className={styles.chartSub}>Sets by muscle group · last 4 weeks</div>
        {Object.entries(grp).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' }}>
            <span style={{ width: '52px', fontSize: '11px', color: 'var(--muted)', textTransform: 'capitalize' }}>{k}</span>
            <div style={{ flex: 1, height: '9px', background: 'var(--raised)', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${((v / gtot) * 100).toFixed(0)}%`, background: colours[k], borderRadius: '5px' }} />
            </div>
            <span className="mono" style={{ width: '34px', textAlign: 'right', fontSize: '12px', color: 'var(--dim)' }}>{v}</span>
          </div>
        ))}
        <div style={{ fontSize: '11.5px', color: 'var(--dim)', marginTop: '10px', lineHeight: 1.5 }}>
          Legs should be the biggest bar. For 14 months it was the smallest — that's the thing this plan exists to fix.
        </div>
      </div>
      <div style={{ height: '20px' }} />
    </div>
  )
}

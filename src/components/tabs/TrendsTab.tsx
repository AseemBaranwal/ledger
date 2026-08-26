import { useState, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react'
import { useSessionStore, useConfigStore, useUIStore, useUnitStore, useGoogleHealthStore } from '@/store'
import { useCustomExerciseStore } from '@/store/customExerciseStore'
import { iso, fmtD, ago } from '@/services/dateUtils'
import { streak } from '@/services/trendCalculations'
import { resolveExerciseDisplay } from '@/services/exerciseCatalog'
import { displayWeight, unitLabel } from '@/services/units'
import { plotLine, nearestPointIndex, type ChartPoint } from '@/services/chartGeometry'
import {
  fetchBodyWeightData,
  fetchRecoveryData,
  type WeightDataResult,
  type RecoveryDataResult,
} from '@/services/googleHealth'
import { GoogleHealthMark } from '@/components/icons/BrandIcons'
import appStyles from '../../styles/App.module.css'
import styles from '../../styles/components.module.css'

interface LinePt { v: number; l: string }
interface BarPt { l: string; v: number }
type TrendDomain = 'lifts' | 'body' | 'recovery'

const GOOGLE_BLUE = '#4285F4'

// "Big number, minimal sparkline" — chosen over labeled-points-per-chart
// (see the mockup comparison linked from the commit) because it leads with
// the one figure that matters most when glancing at a single exercise
// (today's working weight) and keeps the supporting trend line quiet
// rather than competing with it. The tradeoff, accepted deliberately: the
// trend *shape* reads slightly less immediately than the labeled-points
// version did — tap the chart for an exact date/value at any point.
function LineChart({ pts, colour, h = 76 }: { pts: LinePt[]; colour: string; h?: number }) {
  // Tap-to-reveal an exact date + value. Auto-dismisses so it doesn't
  // linger and get mistaken for a permanent label.
  const [tap, setTap] = useState<{ i: number; xPct: number } | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(dismissTimer.current), [])

  if (pts.length < 2) return null // callers already filter this; kept as a safe no-op

  const W = 320
  const H = h
  const pad = { t: 10, r: 10, b: 10, l: 10 }
  const { plotted, path } = plotLine(pts as ChartPoint[], W, H, pad)
  const last = plotted[plotted.length - 1]
  const area = `${path}L${last.x.toFixed(1)},${H - pad.b}L${plotted[0].x.toFixed(1)},${H - pad.b}Z`
  const gid = 'g' + Math.random().toString(36).slice(2, 7)

  const handleTap = (e: MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    setTap({ i: nearestPointIndex(frac, pts.length), xPct: frac * 100 })
    clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setTap(null), 1800)
  }

  return (
    <div className={styles.chartWrap}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: h }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity={0.26} />
            <stop offset="100%" stopColor={colour} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={path} fill="none" stroke={colour} strokeWidth={2.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {plotted.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === plotted.length - 1 ? 4 : 2.4}
            fill={i === plotted.length - 1 ? colour : 'var(--ink)'}
            stroke={colour}
            strokeWidth={1.6}
          />
        ))}
        {/* Transparent hit target for tap-to-reveal — the visible marks
            above are all vector shapes tolerant of the width-only stretch;
            this rect just needs to cover the same box for hit-testing. */}
        <rect x={0} y={0} width={W} height={H} fill="transparent" onClick={handleTap} style={{ cursor: 'pointer' }} />
      </svg>

      {tap && (
        <div className={styles.chartTip} style={{ left: `${tap.xPct}%` }}>
          {pts[tap.i].l} · {pts[tap.i].v}
        </div>
      )}

      {/* Dates as real HTML below the SVG, not <text> inside it — the
          actual fix for the squished-label bug: an SVG <text> element
          inside a preserveAspectRatio="none" box (needed above so the
          chart can fill a responsive width at a fixed height) gets
          stretched non-uniformly along with everything else, which is
          exactly what mangled these labels before. Plain HTML text
          isn't subject to that internal viewBox transform at all. */}
      <div className={`${styles.chartDates} mono`}>
        <span>{pts[0].l}</span>
        <span>{pts[pts.length - 1].l}</span>
      </div>
    </div>
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

function DomainPills({ domain, onSelect }: { domain: TrendDomain; onSelect: (d: TrendDomain) => void }) {
  const items: Array<{ id: TrendDomain; label: string; icon: ReactNode }> = [
    {
      id: 'lifts',
      label: 'Lifts',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 20V10M12 20V4M18 20v-7" />
        </svg>
      ),
    },
    {
      id: 'body',
      label: 'Body',
      icon: <GoogleHealthMark size="15px" />,
    },
    {
      id: 'recovery',
      label: 'Recovery',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l2-7 4 14 2-7h6" />
        </svg>
      ),
    },
  ]
  return (
    <div className={styles.domainRow}>
      {items.map((it) => (
        <button
          key={it.id}
          className={`${styles.domainPill} ${domain === it.id ? styles.active : ''}`}
          onClick={() => onSelect(it.id)}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}

// Shown in place of the Body or Recovery domain's content whenever there's
// no usable Google Health connection — so picking either tab always shows
// something actionable (issue #72's follow-up) instead of an empty screen.
// Google Health is the only provider today; framed generically enough
// ("connect a health app") that a future Apple Health/Fit option could
// join without a copy rewrite, but not built out now — there's nothing
// else to actually connect yet.
function HealthConnectPrompt({ label, needsReconnect, onConnect }: { label: string; needsReconnect: boolean; onConnect: () => void }) {
  return (
    <div className={`${styles.chartCard} ${styles.healthPrompt}`}>
      <div className={styles.healthPromptBadge} style={{ background: needsReconnect ? 'var(--amber)' : GOOGLE_BLUE, color: needsReconnect ? 'var(--ink)' : '#fff' }}>
        <GoogleHealthMark size="20px" />
      </div>
      <div className={styles.healthPromptTitle}>{needsReconnect ? 'Reconnect Google Health' : 'Connect a health app'}</div>
      <div className={styles.healthPromptBody}>
        {needsReconnect
          ? `Google Health access expired — reconnect to keep seeing ${label} here.`
          : `Link Google Health to see ${label} here.`}
      </div>
      <button className={`${styles.btn} ${styles.ghost}`} onClick={onConnect}>
        {needsReconnect ? 'Reconnect' : 'Connect Google Health'}
      </button>
    </div>
  )
}

function formatSleepDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m}m`
}

export function TrendsTab() {
  const sessions = useSessionStore((s) => s.sessions)
  const program = useConfigStore((s) => s.program)
  const colours = useConfigStore((s) => s.colours)
  const customExercises = useCustomExerciseStore((s) => s.customExercises)
  const selectedGroup = useUIStore((s) => s.selectedTrendGroup)
  const setTrendGroup = useUIStore((s) => s.setTrendGroup)
  const selectedDomain = useUIStore((s) => s.selectedTrendDomain)
  const setTrendDomain = useUIStore((s) => s.setTrendDomain)
  const unitSystem = useUnitStore((s) => s.unitSystem) ?? 'imperial'
  const isMetric = unitSystem === 'metric'
  const googleHealthConnected = useGoogleHealthStore((s) => s.connected)
  const googleHealthNeedsReconnect = useGoogleHealthStore((s) => s.needsReconnect)
  const connectGoogleHealth = useGoogleHealthStore((s) => s.connect)

  // Fetched only once the relevant domain is actually selected, not
  // unconditionally on mount — recovery data in particular costs 2-3
  // upstream Google calls per request, no reason to pay that for a domain
  // the person isn't even looking at. Both persist (weight, server-side —
  // see api/_lib/bodyWeightData.ts) or read (recovery) the same way the
  // Coach's own tools do, just reachable without a chat turn. Placed
  // before the early return below, same reason as the useMemo right after
  // it — hooks must run in the same order every render.
  const [weightData, setWeightData] = useState<WeightDataResult | null>(null)
  useEffect(() => {
    if (!googleHealthConnected || googleHealthNeedsReconnect || selectedDomain !== 'body') return
    let cancelled = false
    fetchBodyWeightData(90)
      .then((res) => {
        if (!cancelled) setWeightData(res)
      })
      .catch(() => {
        if (!cancelled) setWeightData({ status: 'error', error: 'Could not load body-weight data' })
      })
    return () => {
      cancelled = true
    }
  }, [googleHealthConnected, googleHealthNeedsReconnect, selectedDomain])

  const [recoveryData, setRecoveryData] = useState<RecoveryDataResult | null>(null)
  useEffect(() => {
    if (!googleHealthConnected || googleHealthNeedsReconnect || selectedDomain !== 'recovery') return
    let cancelled = false
    fetchRecoveryData(30)
      .then((res) => {
        if (!cancelled) setRecoveryData(res)
      })
      .catch(() => {
        if (!cancelled) setRecoveryData({ status: 'error', error: 'Could not load recovery data' })
      })
    return () => {
      cancelled = true
    }
  }, [googleHealthConnected, googleHealthNeedsReconnect, selectedDomain])

  // Both blocks only depend on sessions/program, not on the selected-group
  // filter or unit system — memoized so switching the group tab or tapping
  // a chart point (unrelated state elsewhere in this component) doesn't
  // rebuild them from scratch. Placed before the early return below so the
  // hook always runs in the same order (Rules of Hooks).
  const { weeks, grp, gtot } = useMemo(() => {
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

    return { weeks, grp, gtot }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, program])

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

  // Sprint excluded here, not just hidden downstream — sprint sessions log
  // a rep count into the weight field (w: 0), so a per-exercise weight
  // chart for it was always a flat zero line, never real data. Conditioning
  // work needs its own metric (distance/pace/time) before it earns a chart
  // here, not a forced fit into the strength-progression view.
  const allGroups = [...new Set(allK.map(groupOf))].filter((g) => g !== 'Sprint')
  const trendGroup = allGroups.includes(selectedGroup) ? selectedGroup : allGroups[0]
  const groupExercises = allK.filter((k) => groupOf(k) === trendGroup)

  const healthState: 'off' | 'warn' | 'on' = !googleHealthConnected ? 'off' : googleHealthNeedsReconnect ? 'warn' : 'on'

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

      <DomainPills domain={selectedDomain} onSelect={setTrendDomain} />

      {selectedDomain === 'lifts' && (
        <>
          <select className={styles.pick} value={trendGroup} onChange={(e) => setTrendGroup(e.target.value)}>
            {allGroups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          {groupExercises.map((k) => {
            // The exercise's own unit isn't in the session log itself, only
            // its weight numbers — look it up from the current program def,
            // same fallback-to-'lb' reasoning as HistoryTab.
            const exUnit = Object.values(program).flatMap((p) => p.ex).find((x) => x.k === k)?.u || 'lb'
            const convert = isMetric && (exUnit === 'lb' || exUnit === '+lb')
            const pts = sessions
              .filter((s) => (s.ex || []).some((e) => e.k === k))
              .map((s) => {
                const e = s.ex!.find((x) => x.k === k)!
                const w = e.ws ? Math.max(...e.ws) : e.w || 0
                return { v: convert ? displayWeight(w, 'metric') : w, l: fmtD(s.d).replace(/^\w+, /, '') }
              })
            // A single logged session can't show a progression — there's
            // nothing to compare it to — so skip the whole card rather than
            // rendering a title/delta around an empty chart placeholder.
            if (pts.length < 2) return null
            const dl = pts[pts.length - 1].v - pts[0].v
            const dcls = dl > 0 ? styles.up : dl < 0 ? styles.dn : styles.flat
            const unit = convert ? unitLabel('metric').toLowerCase() : 'lb'

            return (
              <div key={k} className={styles.chartCard}>
                <div className={styles.chartHd}>
                  <h3>{nameOf(k)}</h3>
                  <span className={`${styles.delta} ${dcls}`}>{dl > 0 ? '+' : ''}{dl} {unit}</span>
                </div>
                <div className={styles.statNow}>
                  <span className="mono">{pts[pts.length - 1].v}</span>
                  <span className={styles.statUnit}>{unit}</span>
                </div>
                <LineChart pts={pts} colour={colOf(k)} />
              </div>
            )
          })}
        </>
      )}

      {selectedDomain === 'body' && (
        <>
          {healthState !== 'on' ? (
            <HealthConnectPrompt label="your body-weight trend" needsReconnect={healthState === 'warn'} onConnect={connectGoogleHealth} />
          ) : weightData == null ? (
            <div className={styles.note}>Loading…</div>
          ) : weightData.status === 'ok' && weightData.days.length >= 2 ? (
            (() => {
              const pts = weightData.days.map((d) => ({
                v: isMetric ? displayWeight(d.weightLb, 'metric') : d.weightLb,
                l: fmtD(d.date).replace(/^\w+, /, ''),
              }))
              const dl = Math.round((pts[pts.length - 1].v - pts[0].v) * 10) / 10
              const dcls = dl > 0 ? styles.up : dl < 0 ? styles.dn : styles.flat
              const unit = isMetric ? unitLabel('metric').toLowerCase() : 'lb'
              return (
                <div className={styles.chartCard}>
                  <div className={styles.chartHd}>
                    <h3>Body weight</h3>
                    <span className={`${styles.delta} ${dcls}`}>{dl > 0 ? '+' : ''}{dl} {unit}</span>
                  </div>
                  <div className={styles.statNow}>
                    <span className="mono">{pts[pts.length - 1].v}</span>
                    <span className={styles.statUnit}>{unit}</span>
                  </div>
                  <LineChart pts={pts} colour="#8B7CF6" />
                </div>
              )
            })()
          ) : weightData.status === 'error' ? (
            <div className={styles.note}>Could not load body-weight data right now.</div>
          ) : (
            <div className={styles.note}>Not enough readings yet — check back once your scale has synced a couple more.</div>
          )}
        </>
      )}

      {selectedDomain === 'recovery' && (
        <>
          {healthState !== 'on' ? (
            <HealthConnectPrompt label="resting heart rate, HRV, and sleep" needsReconnect={healthState === 'warn'} onConnect={connectGoogleHealth} />
          ) : recoveryData == null ? (
            <div className={styles.note}>Loading…</div>
          ) : recoveryData.status === 'error' ? (
            <div className={styles.note}>Could not load recovery data right now.</div>
          ) : recoveryData.status === 'ok' && recoveryData.latest ? (
            <>
              <div className={styles.statRow}>
                <div className={styles.stat}>
                  <div className={styles.l}>Resting HR</div>
                  <div className={styles.v}>{recoveryData.latest.restingHeartRate ?? '—'}</div>
                  <div className={styles.d}>
                    {recoveryData.latest.restingHeartRate != null ? 'bpm' : 'no data'}
                    {recoveryData.deltas?.restingHeartRate != null && ` · ${recoveryData.deltas.restingHeartRate > 0 ? '+' : ''}${recoveryData.deltas.restingHeartRate} vs baseline`}
                  </div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.l}>HRV</div>
                  <div className={styles.v}>{recoveryData.latest.hrvMs ?? '—'}</div>
                  <div className={styles.d}>
                    {recoveryData.latest.hrvMs != null ? 'ms' : 'no data'}
                    {recoveryData.deltas?.hrvPercent != null && ` · ${recoveryData.deltas.hrvPercent > 0 ? '+' : ''}${recoveryData.deltas.hrvPercent}%`}
                  </div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.l}>Sleep</div>
                  <div className={styles.v}>{recoveryData.latest.sleepMinutes != null ? formatSleepDuration(recoveryData.latest.sleepMinutes) : '—'}</div>
                  <div className={styles.d}>last night</div>
                </div>
              </div>

              {(recoveryData.readiness || recoveryData.flags.length > 0) && (
                <div className={styles.chartCard}>
                  {recoveryData.readiness && (
                    <div className={styles.flagRow}>
                      <span
                        className={styles.flagDot}
                        style={{
                          background:
                            recoveryData.readiness === 'primed'
                              ? 'var(--teal)'
                              : recoveryData.readiness === 'compromised'
                                ? 'var(--coral)'
                                : 'var(--amber)',
                        }}
                      />
                      Readiness: {recoveryData.readiness}
                    </div>
                  )}
                  {recoveryData.flags.map((flag, i) => (
                    <div key={i} className={styles.flagRow}>
                      <span className={styles.flagDot} style={{ background: 'var(--line-2)' }} />
                      {flag}
                    </div>
                  ))}
                </div>
              )}

              {(
                [
                  { key: 'restingHeartRate' as const, label: 'Resting heart rate', colour: '#FF6B4A', unit: 'bpm' },
                  { key: 'hrvMs' as const, label: 'HRV', colour: '#4C9BE8', unit: 'ms' },
                ]
              ).map(({ key, label, colour, unit }) => {
                const pts = recoveryData.days
                  .filter((d) => d[key] != null)
                  .map((d) => ({ v: d[key] as number, l: fmtD(d.date).replace(/^\w+, /, '') }))
                if (pts.length < 2) return null
                return (
                  <div key={key} className={styles.chartCard}>
                    <div className={styles.chartHd}>
                      <h3>{label}</h3>
                    </div>
                    <div className={styles.statNow}>
                      <span className="mono">{pts[pts.length - 1].v}</span>
                      <span className={styles.statUnit}>{unit}</span>
                    </div>
                    <LineChart pts={pts} colour={colour} />
                  </div>
                )
              })}
            </>
          ) : (
            <div className={styles.note}>No recovery data in the last 30 days yet — check back once your watch has synced.</div>
          )}
        </>
      )}

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

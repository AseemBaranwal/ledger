// Pure geometry for TrendsTab's line charts, split out of the component so
// the point-plotting and curve math can be unit-tested directly rather than
// only exercised through a full render.

export interface ChartPoint {
  v: number
  l: string
}

export interface PlottedPoint {
  x: number
  y: number
  v: number
  l: string
}

export interface ChartPadding {
  t: number
  r: number
  b: number
  l: number
}

// Maps data points onto a width×height box and returns both the plotted
// pixel positions (needed for value labels, dots, and tap hit-testing) and
// an SVG path string for the line itself.
//
// Plain straight segments between points, not a smoothed curve — a
// midpoint-control-point bezier was tried first, but it forces a
// horizontal tangent at every point, which reads fine for exactly 2 points
// (the only case actually checked against the mockup) and produces a
// visibly flat "shelf" around any middle point once a series has 3+
// sessions, since real data. Confirmed against the real chosen mockup
// screenshot, which used plain straight lines throughout.
export function plotLine(pts: ChartPoint[], width: number, height: number, pad: ChartPadding): { plotted: PlottedPoint[]; path: string } {
  const ys = pts.map((p) => p.v)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const span = y1 - y0 || 1
  // 30% headroom above/below the data range so the line never touches the
  // very top/bottom edge.
  const lo = y0 - span * 0.3
  const hi = y1 + span * 0.3

  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const X = (i: number) => pad.l + (pts.length > 1 ? (i / (pts.length - 1)) * innerW : innerW / 2)
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * innerH

  const plotted: PlottedPoint[] = pts.map((p, i) => ({ x: X(i), y: Y(p.v), v: p.v, l: p.l }))

  const path = plotted.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')

  return { plotted, path }
}

// Given a tap/click position as a 0-1 fraction across the chart's width,
// finds which data point it's closest to — used to show an exact-value
// tooltip on tap. Clamped so a tap slightly outside the plotted area (e.g.
// in the padding) still resolves to an endpoint rather than nothing.
export function nearestPointIndex(fraction: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(fraction * (count - 1))))
}

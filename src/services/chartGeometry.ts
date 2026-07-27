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
// an SVG path string for the line itself. The path is smoothed with a
// simple midpoint-control-point bezier between each consecutive pair of
// points — enough to soften the straight-segment look for the small point
// counts most exercises actually produce (2-6 sessions in a trend window),
// without pulling in a curve-fitting library just for this.
export function plotLine(pts: ChartPoint[], width: number, height: number, pad: ChartPadding): { plotted: PlottedPoint[]; path: string } {
  const ys = pts.map((p) => p.v)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const span = y1 - y0 || 1
  // 30% headroom above/below the data range so the line never touches the
  // very top/bottom edge — matters more now that point value labels sit
  // just above each dot and need room to not clip.
  const lo = y0 - span * 0.3
  const hi = y1 + span * 0.3

  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const X = (i: number) => pad.l + (pts.length > 1 ? (i / (pts.length - 1)) * innerW : innerW / 2)
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * innerH

  const plotted: PlottedPoint[] = pts.map((p, i) => ({ x: X(i), y: Y(p.v), v: p.v, l: p.l }))

  let path = `M${plotted[0].x.toFixed(1)},${plotted[0].y.toFixed(1)}`
  for (let i = 0; i < plotted.length - 1; i++) {
    const a = plotted[i]
    const b = plotted[i + 1]
    const mx = ((a.x + b.x) / 2).toFixed(1)
    path += `C${mx},${a.y.toFixed(1)} ${mx},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
  }

  return { plotted, path }
}

// Given a tap/click position as a 0-1 fraction across the chart's width,
// finds which data point it's closest to — used to show an exact-value
// tooltip on tap. Clamped so a tap slightly outside the plotted area (e.g.
// in the padding) still resolves to an endpoint rather than nothing.
export function nearestPointIndex(fraction: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(fraction * (count - 1))))
}

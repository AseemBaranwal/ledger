import { describe, it, expect } from 'vitest'
import { plotLine, nearestPointIndex } from '@/services/chartGeometry'

describe('plotLine', () => {
  it('spaces points evenly across the available width', () => {
    const { plotted } = plotLine([{ v: 10, l: 'a' }, { v: 20, l: 'b' }, { v: 30, l: 'c' }], 300, 100, { t: 10, r: 10, b: 10, l: 10 })
    expect(plotted[0].x).toBe(10)
    expect(plotted[2].x).toBe(290)
    expect(plotted[1].x).toBeCloseTo(150, 0)
  })

  it('plots a higher value above (smaller y than) a lower value', () => {
    const { plotted } = plotLine([{ v: 10, l: 'a' }, { v: 20, l: 'b' }], 300, 100, { t: 10, r: 10, b: 10, l: 10 })
    expect(plotted[1].y).toBeLessThan(plotted[0].y)
  })

  it('does not divide by zero for a flat (equal-value) series', () => {
    const { plotted } = plotLine([{ v: 50, l: 'a' }, { v: 50, l: 'b' }], 300, 100, { t: 10, r: 10, b: 10, l: 10 })
    expect(Number.isFinite(plotted[0].y)).toBe(true)
    expect(Number.isFinite(plotted[1].y)).toBe(true)
  })

  it('starts the path with a moveto at the first plotted point', () => {
    const { plotted, path } = plotLine([{ v: 10, l: 'a' }, { v: 20, l: 'b' }], 300, 100, { t: 10, r: 10, b: 10, l: 10 })
    expect(path.startsWith(`M${plotted[0].x.toFixed(1)},${plotted[0].y.toFixed(1)}`)).toBe(true)
  })

  it('emits one straight lineto segment per point-to-point gap, no curve smoothing', () => {
    const { path } = plotLine([{ v: 10, l: 'a' }, { v: 20, l: 'b' }, { v: 15, l: 'c' }], 300, 100, { t: 10, r: 10, b: 10, l: 10 })
    expect((path.match(/L/g) || []).length).toBe(2)
    expect(path).not.toContain('C')
  })
})

describe('nearestPointIndex', () => {
  it('rounds to the closest index', () => {
    expect(nearestPointIndex(0, 5)).toBe(0)
    expect(nearestPointIndex(1, 5)).toBe(4)
    expect(nearestPointIndex(0.5, 5)).toBe(2)
  })

  it('clamps a fraction slightly outside 0-1 to a valid endpoint', () => {
    expect(nearestPointIndex(-0.1, 5)).toBe(0)
    expect(nearestPointIndex(1.1, 5)).toBe(4)
  })
})

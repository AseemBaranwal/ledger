import { describe, it, expect } from 'vitest'
import { estimateCostUsd, formatTokenCount, formatCostUsd } from '@/services/chatCost'

describe('estimateCostUsd', () => {
  it('computes input+output cost at their published per-million rates', () => {
    const usd = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 })
    expect(usd).toBeCloseTo(2.0 + 10.0, 5)
  })

  it('prices cache reads far below base input', () => {
    const cacheReadCost = estimateCostUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 })
    const inputCost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
    expect(cacheReadCost).toBeLessThan(inputCost)
  })

  it('returns 0 for no usage at all', () => {
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(0)
  })
})

describe('formatTokenCount', () => {
  it('shows small counts as a plain number', () => {
    expect(formatTokenCount(842)).toBe('842')
  })

  it('shows thousands with a k suffix, trimming a trailing .0', () => {
    expect(formatTokenCount(12400)).toBe('12.4k')
    expect(formatTokenCount(5000)).toBe('5k')
  })

  it('shows millions with an M suffix', () => {
    expect(formatTokenCount(2_500_000)).toBe('2.5M')
  })
})

describe('formatCostUsd', () => {
  it('shows a plain $0.00 for zero cost', () => {
    expect(formatCostUsd(0)).toBe('$0.00')
  })

  it('shows a floor for anything under a cent, rather than a misleading $0.00', () => {
    expect(formatCostUsd(0.002)).toBe('<$0.01')
  })

  it('shows an approximate-prefixed dollar amount for anything at or above a cent', () => {
    expect(formatCostUsd(0.034)).toBe('~$0.03')
    expect(formatCostUsd(1.2)).toBe('~$1.20')
  })
})

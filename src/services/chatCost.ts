// Rough cost estimate for the Coach usage line — deliberately approximate,
// not a billing reconciliation. Rates as published for claude-sonnet-5,
// introductory pricing in effect through 2026-08-31 (verified against
// Anthropic's current pricing page, not assumed): $2/M input, $10/M output.
// Cache reads are documented at ~10% of the base input rate. Cache writes
// aren't separately confirmed for this model's 1h TTL, so this uses
// Anthropic's standard 1h-cache-write multiplier (2x base input) as a
// reasonable estimate rather than guessing a number with no basis — this
// only matters for the (rare) turn that actually creates a new cache
// entry, not the many turns that just read from it.
const PRICE_PER_MILLION = {
  input: 2.0,
  output: 10.0,
  cacheRead: 0.2,
  cacheWrite: 4.0,
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export function estimateCostUsd(usage: TokenUsage): number {
  return (
    (usage.inputTokens / 1_000_000) * PRICE_PER_MILLION.input +
    (usage.outputTokens / 1_000_000) * PRICE_PER_MILLION.output +
    (usage.cacheReadTokens / 1_000_000) * PRICE_PER_MILLION.cacheRead +
    (usage.cacheCreationTokens / 1_000_000) * PRICE_PER_MILLION.cacheWrite
  )
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function formatCostUsd(usd: number): string {
  if (usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `~$${usd.toFixed(2)}`
}

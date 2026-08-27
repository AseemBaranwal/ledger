import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../api/_lib/chatSystemPrompt'

describe('buildSystemPrompt', () => {
  it('is byte-stable across calls (required for prompt caching to actually save cost)', () => {
    // The whole point of this prompt is that it's static, no per-request
    // interpolation — if a future edit accidentally adds a timestamp or
    // other dynamic value, this catches it before it silently defeats
    // caching in production.
    expect(buildSystemPrompt()).toBe(buildSystemPrompt())
  })

  it('includes the hardening rules that keep the coach in scope', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('DATA HONESTY')
    expect(prompt).toContain('NO SILENT WRITES')
    expect(prompt).toContain('get_training_data')
    expect(prompt).toContain('suggest_exercise_adjustment')
    expect(prompt).toContain('suggest_exercise_swap')
  })

  it('forbids describing a suggestion as queued/ready without an actual tool call', () => {
    // Caught live: the model replied "Queued: swap Leg Press -> Back Squat,
    // ready to accept in the app" with an EMPTY tool_calls array — no
    // suggest_exercise_swap invocation happened, so no suggestion existed
    // for the person to accept. The card literally could not have rendered.
    const prompt = buildSystemPrompt()
    expect(prompt).toContain("NEVER DESCRIBE A SUGGESTION YOU DIDN'T ACTUALLY PROPOSE")
  })

  it('instructs Markdown output for the chat bubble', () => {
    expect(buildSystemPrompt().toLowerCase()).toContain('markdown')
  })

  // The prompt itself is deliberately static (see the byte-stability test
  // above), so it can never carry today's date — this tells the model to
  // get it from get_training_data's response instead of guessing from the
  // most recent session row.
  it('tells the model to use get_training_data\'s today field rather than inferring the date', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('response also includes `today`')
    expect(prompt).toContain("Don't guess today's date")
  })

  it('backtick-formats tool names and code references so the model distinguishes them from prose', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('`get_training_data`')
    expect(prompt).toContain('`suggest_exercise_adjustment`')
    expect(prompt).toContain('`suggest_exercise_swap`')
  })
})

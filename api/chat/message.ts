import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { callAnthropic, type AnthropicMessage, type AnthropicResponseBlock } from '../_lib/anthropic.js'
import { buildSystemPrompt } from '../_lib/chatSystemPrompt.js'
import { TOOLS, getTrainingData, getRecoveryData, getBodyWeightData, resolveExerciseSwap } from '../_lib/chatTools.js'
import { saveChatTurn } from '../_lib/chatHistory.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

const MAX_MESSAGE_CHARS = 4000
// The client only ever sends the last MAX_MESSAGES_SENT (24, see
// chatStore.ts) messages per turn — this is a server-side backstop, not the
// primary control, so a stale/buggy client can't bill an ever-growing,
// uncached history against this endpoint regardless of what the client-side
// slice is supposed to enforce. Set well above 24 so a legitimate client is
// never rejected by its own normal behavior.
const MAX_INBOUND_MESSAGES = 40
// Bumped from 4 — analysis of real chat_logs found a genuine case (7 tool
// calls: get_training_data + 6x suggest_exercise_swap, spread across
// exactly 4 iterations) that exhausted the old cap while the model still
// wanted to keep going, falling back to the generic "try asking again"
// reply below instead of a real answer. The extra headroom here is paired
// with the FORCED-text-only final iteration below — the two together mean
// a real answer is now near-guaranteed even on a big multi-suggestion turn,
// not just less likely to run out.
const MAX_TOOL_ITERATIONS = 5
const DEFAULT_DAILY_LIMIT = 60
const DEFAULT_WINDOW_LIMIT = 10

function isOwner(userId: string): boolean {
  const allowList = (process.env.CHAT_OWNER_USER_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return allowList.includes(userId)
}

interface Suggestion {
  kind: 'adjustment' | 'swap'
  exerciseCode: string
  exerciseName: string
  reasoning: string
  // adjustment fields — each independently optional, a proposal can touch
  // just one of weight/reps/sets
  currentWeight?: number
  suggestedWeight?: number
  currentReps?: number
  suggestedReps?: number
  currentSets?: number
  suggestedSets?: number
  // swap fields — already resolved server-side against the exercise
  // catalog by the time this is recorded, never raw model output
  newExerciseCode?: string
  newExerciseName?: string
}

// Best-effort — a logging failure must never fail the actual chat response.
// stop_reason and reply are logged on every call (success, silent-empty, or
// error) — see supabase/chat_logs_add_reply_debug_columns.sql. Previously
// only token counts and a generic error string were persisted, so a call
// that "succeeded" with an empty reply left zero trace to debug from.
async function logChatCall(row: {
  user_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  tool_calls: string[]
  latency_ms: number
  stop_reason: string | null
  reply: string
  thinking: string
  error: string | null
}) {
  try {
    // See exchange.ts for why this cast is needed — no generated Database
    // type, so supabase-js can't infer chat_logs' row shape.
    await (supabaseAdmin().from('chat_logs') as any).insert(row)
  } catch {
    // ignore — never let logging break the response
  }
}

export interface DailyTokenTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

// Sums every token field across today's calls for the compact usage line in
// the UI — a handful of rows per day at most, so summing in JS after a
// plain select is simpler than a Postgres aggregate function for this
// volume. Kept broken out by token type (not one combined number) because
// input/output/cache-read/cache-write are priced very differently — the
// client needs the breakdown to estimate cost accurately, not just a total
// token count. Best-effort: a failure here shouldn't block the chat
// response, it just means the usage numbers are temporarily zeroed out.
async function fetchDailyTokenTotals(userId: string): Promise<DailyTokenTotals> {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  try {
    const { data } = await supabaseAdmin()
      .from('chat_logs')
      .select('input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    type TokenRow = { input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; cache_creation_tokens: number | null }
    return ((data as TokenRow[]) || []).reduce(
      (totals, row) => ({
        inputTokens: totals.inputTokens + (row.input_tokens || 0),
        outputTokens: totals.outputTokens + (row.output_tokens || 0),
        cacheReadTokens: totals.cacheReadTokens + (row.cache_read_tokens || 0),
        cacheCreationTokens: totals.cacheCreationTokens + (row.cache_creation_tokens || 0),
      }),
      zero
    )
  } catch {
    return zero
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const user = await requireUser(req)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  if (!isOwner(user.id)) {
    return new Response(JSON.stringify({ error: 'Not available for this account' }), { status: 403 })
  }

  let payload: { messages?: AnthropicMessage[] }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const inbound = Array.isArray(payload.messages) ? payload.messages : []
  if (!inbound.length) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), { status: 400 })
  }
  if (inbound.length > MAX_INBOUND_MESSAGES) {
    return new Response(JSON.stringify({ error: `Too much history sent (max ${MAX_INBOUND_MESSAGES} messages)` }), { status: 400 })
  }
  const lastMessage = inbound[inbound.length - 1]
  const lastText = typeof lastMessage.content === 'string' ? lastMessage.content : ''
  if (lastText.length > MAX_MESSAGE_CHARS) {
    return new Response(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` }), { status: 400 })
  }

  const dailyLimit = Number(process.env.CHAT_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT
  const windowLimit = Number(process.env.CHAT_WINDOW_LIMIT) || DEFAULT_WINDOW_LIMIT

  const [{ count: dailyCount }, { count: windowCount }] = await Promise.all([
    supabaseAdmin()
      .from('chat_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    supabaseAdmin()
      .from('chat_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()),
  ])

  if ((dailyCount ?? 0) >= dailyLimit) {
    return new Response(JSON.stringify({ error: `Daily message limit reached (${dailyLimit}/day). Try again tomorrow.` }), { status: 429 })
  }
  if ((windowCount ?? 0) >= windowLimit) {
    return new Response(JSON.stringify({ error: `Sending too fast — limit is ${windowLimit} messages per 10 minutes.` }), { status: 429 })
  }

  const systemPrompt = buildSystemPrompt()
  const messages: AnthropicMessage[] = [...inbound]
  const suggestions: Suggestion[] = []
  const toolCallNames: string[] = []
  const startedAt = Date.now()

  // Edge Functions must start sending a response within 25s, but a
  // multi-step tool loop at high reasoning effort can genuinely take longer
  // than that in total — Vercel's own limit is on time-to-first-byte, not
  // total duration, so the fix is to stream: return the Response (and start
  // sending status bytes) immediately, then keep writing to it as the tool
  // loop actually runs. Newline-delimited JSON rather than real SSE since
  // there's no need for event-stream semantics, just progressive delivery.
  const encoder = new TextEncoder()
  // ReadableStream's start() callback runs synchronously inside the
  // constructor, so this is always assigned before any other code below
  // runs — TS's control-flow analysis just can't see through the callback.
  let streamController!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })
  const send = (obj: unknown) => {
    streamController.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  const statusForTool = (name: string) =>
    name === 'get_training_data'
      ? 'Checking your training data…'
      : name === 'get_recovery_data'
        ? 'Checking your recovery data…'
        : name === 'get_body_weight_data'
          ? 'Checking your body-weight data…'
          : name === 'suggest_exercise_adjustment'
            ? 'Working out a suggestion…'
            : name === 'suggest_exercise_swap'
              ? 'Finding a good alternate…'
              : 'Working on it…'

  ;(async () => {
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheReadTokens = 0
    let totalCacheCreationTokens = 0
    let reply = ''
    let callError: string | null = null
    let finalStopReason: string | null = null
    const thinkingChunks: string[] = []

    try {
      send({ type: 'status', message: 'Thinking…' })

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        // The final iteration omits `tools` entirely rather than letting
        // the model request yet another one — with no tools available it
        // MUST respond with text, so `stop_reason` naturally comes back
        // something other than 'tool_use' and the block below always
        // takes the "give a real reply" path instead of running out of
        // loop with nothing to show. Confirmed against real chat_logs data
        // that the old unconditional-tools version could exhaust every
        // iteration on tool_use and fall back to a placeholder message
        // (see MAX_TOOL_ITERATIONS's own comment for the specific case).
        const isLastIteration = iteration === MAX_TOOL_ITERATIONS - 1
        const response = await callAnthropic({ systemPrompt, messages, tools: isLastIteration ? undefined : TOOLS })

        totalInputTokens += response.usage.input_tokens || 0
        totalOutputTokens += response.usage.output_tokens || 0
        totalCacheReadTokens += response.usage.cache_read_input_tokens || 0
        totalCacheCreationTokens += response.usage.cache_creation_input_tokens || 0

        // The full content array (including any thinking blocks) must be
        // re-appended as-is between loop iterations — stripping thinking
        // blocks before sending tool_results back breaks the turn.
        messages.push({ role: 'assistant', content: response.content })

        const thinkingText = response.content
          .filter((b): b is Extract<AnthropicResponseBlock, { type: 'thinking' }> => b.type === 'thinking')
          .map((b) => b.thinking)
          .filter(Boolean)
          .join('\n')
        if (thinkingText) {
          thinkingChunks.push(`[iteration ${iteration}] ${thinkingText}`)
          // Streamed to the client per-iteration (not buffered to the end)
          // since that's the real granularity available: the underlying
          // Anthropic call itself isn't token-streamed, so this arrives a
          // whole iteration's reasoning at a time, not word-by-word.
          send({ type: 'thinking', text: thinkingText })
        }

        if (response.stop_reason !== 'tool_use') {
          finalStopReason = response.stop_reason
          reply = response.content
            .filter((b): b is Extract<AnthropicResponseBlock, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim()
          break
        }

        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          toolCallNames.push(block.name)
          send({ type: 'status', message: statusForTool(block.name) })

          if (block.name === 'get_training_data') {
            const args = block.input as { exerciseCode?: string; sinceDate?: string; limit?: number }
            const result = await getTrainingData(user.id, args)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          } else if (block.name === 'get_recovery_data') {
            const args = block.input as { days?: number }
            // Never throws — an unconnected watch, expired Google access, or
            // one data type failing all come back as an explicit status the
            // model is told (in the tool description) to treat as normal.
            const result = await getRecoveryData(user.id, args)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          } else if (block.name === 'get_body_weight_data') {
            const args = block.input as { days?: number }
            // Same never-throws contract as get_recovery_data above.
            const result = await getBodyWeightData(user.id, args)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          } else if (block.name === 'suggest_exercise_adjustment') {
            const args = block.input as unknown as {
              exerciseCode: string
              exerciseName: string
              reasoning: string
              currentWeight?: number
              suggestedWeight?: number
              currentReps?: number
              suggestedReps?: number
              currentSets?: number
              suggestedSets?: number
            }
            const hasChange = args.suggestedWeight != null || args.suggestedReps != null || args.suggestedSets != null
            if (!hasChange) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: 'No change specified — include at least one of suggestedWeight, suggestedReps, or suggestedSets.',
              })
            } else {
              suggestions.push({ kind: 'adjustment', ...args })
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Suggestion noted.' })
            }
          } else if (block.name === 'suggest_exercise_swap') {
            const args = block.input as unknown as {
              currentExerciseCode: string
              currentExerciseName: string
              replacementQuery: string
              reasoning: string
            }
            const resolved = resolveExerciseSwap(args.currentExerciseCode, args.replacementQuery)
            if (!resolved) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ resolved: false, error: `No matching exercise found for "${args.replacementQuery}".` }),
              })
            } else {
              suggestions.push({
                kind: 'swap',
                exerciseCode: args.currentExerciseCode,
                exerciseName: args.currentExerciseName,
                newExerciseCode: resolved.code,
                newExerciseName: resolved.name,
                reasoning: args.reasoning,
              })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ resolved: true, code: resolved.code, name: resolved.name }),
              })
            }
          } else {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Unknown tool.' })
          }
        }

        messages.push({ role: 'user', content: toolResults })

        // Effectively unreachable now, not the common exhaustion path it
        // used to be — the final iteration is called with no tools at all
        // (see isLastIteration above), so a real stop_reason other than
        // 'tool_use' always comes back and the loop breaks out through the
        // check above before ever reaching here on that iteration. Kept as
        // defense-in-depth rather than assumed impossible, in case the API
        // ever returns tool_use with no tools offered.
        if (isLastIteration) {
          reply = "I pulled up your data but need another step to finish — try asking again, maybe a bit more specifically."
        } else {
          send({ type: 'status', message: 'Thinking…' })
        }
      }
    } catch (e) {
      callError = e instanceof Error ? e.message : 'Unknown error calling Anthropic'
    }

    // A call can "succeed" (nothing thrown) yet still carry no usable text —
    // e.g. hitting max_tokens while still in extended thinking, before any
    // text block was ever emitted. Treated as its own error case rather
    // than a normal successful turn, so chat_logs.error and the
    // stop_reason both make an empty reply distinguishable from a real one.
    if (!callError && !reply) {
      callError = `Coach didn't return any reply text (stop_reason: ${finalStopReason ?? 'unknown'}) — try again, maybe with a shorter or more focused question.`
    }

    const latencyMs = Date.now() - startedAt

    // chat_logs (metrics) and chat_messages (conversation content, via
    // saveChatTurn) are different tables written by independent, best-effort
    // calls — neither depends on the other's result, so running them
    // concurrently instead of two sequential awaits shaves a full Supabase
    // round-trip off the tail latency of every reply the client receives.
    // fetchDailyTokenTotals still runs after: it reads back rows including
    // the one logChatCall just wrote, so it does have a real dependency.
    const [, savedIds] = await Promise.all([
      logChatCall({
        user_id: user.id,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cache_read_tokens: totalCacheReadTokens,
        cache_creation_tokens: totalCacheCreationTokens,
        tool_calls: toolCallNames,
        latency_ms: latencyMs,
        stop_reason: finalStopReason,
        reply,
        thinking: thinkingChunks.join('\n\n'),
        error: callError,
      }),
      callError ? Promise.resolve(null) : saveChatTurn(user.id, lastText, reply, suggestions, thinkingChunks.length ? thinkingChunks.join('\n\n') : null),
    ])

    if (callError) {
      send({ type: 'error', error: callError })
    } else {
      // logChatCall() above already wrote this call's own token counts into
      // chat_logs, so this total is already inclusive of the current call —
      // don't add totalInputTokens/totalOutputTokens again on top of it.
      const dailyTotals = await fetchDailyTokenTotals(user.id)
      send({
        type: 'done',
        reply,
        suggestions,
        userMessageId: savedIds?.userMessageId ?? null,
        assistantMessageId: savedIds?.assistantMessageId ?? null,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheReadTokens,
          cacheCreationTokens: totalCacheCreationTokens,
          dailyUsed: (dailyCount ?? 0) + 1,
          dailyLimit,
          dailyInputTokens: dailyTotals.inputTokens,
          dailyOutputTokens: dailyTotals.outputTokens,
          dailyCacheReadTokens: dailyTotals.cacheReadTokens,
          dailyCacheCreationTokens: dailyTotals.cacheCreationTokens,
        },
      })
    }
    streamController.close()
  })()

  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
}

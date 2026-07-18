import { requireUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { callAnthropic, type AnthropicMessage, type AnthropicResponseBlock } from '../_lib/anthropic.js'
import { buildSystemPrompt } from '../_lib/chatSystemPrompt.js'
import { TOOLS, getTrainingData } from '../_lib/chatTools.js'

// See exchange.ts for why this is pinned to the Edge Runtime.
export const config = { runtime: 'edge' }

const MAX_MESSAGE_CHARS = 4000
const MAX_TOOL_ITERATIONS = 4
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
  exerciseCode: string
  exerciseName: string
  currentWeight: number
  suggestedWeight: number
  reasoning: string
}

// Best-effort — a logging failure must never fail the actual chat response.
async function logChatCall(row: {
  user_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  tool_calls: string[]
  latency_ms: number
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
    name === 'get_training_data' ? 'Checking your training data…' : name === 'suggest_weight_change' ? 'Working out a suggestion…' : 'Working on it…'

  ;(async () => {
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheReadTokens = 0
    let totalCacheCreationTokens = 0
    let reply = ''
    let callError: string | null = null

    try {
      send({ type: 'status', message: 'Thinking…' })

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const response = await callAnthropic({ systemPrompt, messages, tools: TOOLS })

        totalInputTokens += response.usage.input_tokens || 0
        totalOutputTokens += response.usage.output_tokens || 0
        totalCacheReadTokens += response.usage.cache_read_input_tokens || 0
        totalCacheCreationTokens += response.usage.cache_creation_input_tokens || 0

        // The full content array (including any thinking blocks) must be
        // re-appended as-is between loop iterations — stripping thinking
        // blocks before sending tool_results back breaks the turn.
        messages.push({ role: 'assistant', content: response.content })

        if (response.stop_reason !== 'tool_use') {
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
          } else if (block.name === 'suggest_weight_change') {
            const args = block.input as unknown as Suggestion
            suggestions.push(args)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Suggestion noted.' })
          } else {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Unknown tool.' })
          }
        }

        messages.push({ role: 'user', content: toolResults })

        if (iteration === MAX_TOOL_ITERATIONS - 1) {
          reply = "I pulled up your data but need another step to finish — try asking again, maybe a bit more specifically."
        } else {
          send({ type: 'status', message: 'Thinking…' })
        }
      }
    } catch (e) {
      callError = e instanceof Error ? e.message : 'Unknown error calling Anthropic'
    }

    const latencyMs = Date.now() - startedAt

    await logChatCall({
      user_id: user.id,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cache_read_tokens: totalCacheReadTokens,
      cache_creation_tokens: totalCacheCreationTokens,
      tool_calls: toolCallNames,
      latency_ms: latencyMs,
      error: callError,
    })

    if (callError) {
      send({ type: 'error', error: callError })
    } else {
      send({
        type: 'done',
        reply,
        suggestions,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheReadTokens,
          cacheCreationTokens: totalCacheCreationTokens,
          dailyUsed: (dailyCount ?? 0) + 1,
          dailyLimit,
        },
      })
    }
    streamController.close()
  })()

  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
}

// Thin wrapper around the Anthropic Messages API using raw fetch — there's
// no @anthropic-ai/sdk dependency in this project (and it wouldn't run under
// Vercel's Edge Runtime anyway), matching how api/strava/exchange.ts already
// calls Strava's REST API directly.
//
// Model/param shapes below were verified directly against
// platform.claude.com/docs/en/api/messages before writing this, not assumed:
// `effort` lives inside `output_config`, NOT top-level, and `thinking` is a
// separate top-level field that coexists with it.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5'

export interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  signature?: string
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type AnthropicResponseBlock = AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | Array<AnthropicResponseBlock | AnthropicToolResultBlock>
}

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicResponseBlock[]
  model: string
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null
  stop_sequence: string | null
  usage: AnthropicUsage
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

interface CallAnthropicParams {
  systemPrompt: string
  messages: AnthropicMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
  effort?: EffortLevel
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Retries on 429/5xx (up to 2 extra attempts), honoring the retry-after
// header in seconds when present, falling back to exponential backoff
// (1s, 2s) otherwise. Network-level failures (fetch throwing) are retried
// the same way. Non-2xx responses that aren't retried, and responses whose
// body isn't valid JSON, throw with the clearest message available rather
// than a generic failure.
export async function callAnthropic({
  systemPrompt,
  messages,
  tools,
  maxTokens = 3072,
  effort = 'high',
}: CallAnthropicParams): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on the server')

  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive', display: 'omitted' },
    output_config: { effort },
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ],
    messages,
  }
  if (tools && tools.length) body.tools = tools

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= 2; attempt++) {
    let res: Response
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      lastError = e instanceof Error ? e : new Error('Network error calling Anthropic')
      await sleep((attempt + 1) * 1000)
      continue
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`Anthropic API returned ${res.status}`)
      const retryAfterHeader = res.headers.get('retry-after')
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN
      const delayMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : (attempt + 1) * 1000
      await sleep(delayMs)
      continue
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw new Error(`Anthropic API returned an unparseable response (status ${res.status})`)
    }

    if (!res.ok) {
      const errBody = data as { error?: { message?: string; type?: string } }
      throw new Error(errBody?.error?.message || errBody?.error?.type || `Anthropic API request failed (status ${res.status})`)
    }

    return data as AnthropicResponse
  }

  throw lastError || new Error('Anthropic API request failed after retries')
}

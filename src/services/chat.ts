import { supabase } from './supabaseClient'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSuggestion {
  exerciseCode: string
  exerciseName: string
  currentWeight: number
  suggestedWeight: number
  reasoning: string
}

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  dailyUsed: number
  dailyLimit: number
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

async function authedGet(path: string): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return fetch(path, { headers: { Authorization: `Bearer ${token}` } })
}

export interface HistoryMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  suggestions: ChatSuggestion[] | null
}

// Called once when the Coach tab mounts — the durable copy of the
// conversation lives server-side now (see supabase/chat_messages.sql), so
// it survives a reload and follows the owner across devices, unlike the
// local zustand-persisted cache which is just a fast-boot copy of whatever
// this one browser last saw.
export async function fetchChatHistory(): Promise<HistoryMessage[]> {
  const res = await authedGet('/api/chat/history')
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not load chat history')
  }
  const data = await res.json()
  return Array.isArray(data.messages) ? data.messages : []
}

// The endpoint streams newline-delimited JSON rather than one buffered
// response — a multi-step tool loop can genuinely take longer than Vercel's
// 25s time-to-first-byte limit for Edge Functions, so the server starts
// sending status events immediately and keeps the connection open while the
// actual work continues. onStatus is optional so callers that don't care
// about progress can ignore it.
export async function sendChatMessage(
  messages: ChatMessage[],
  onStatus?: (message: string) => void
): Promise<{ reply: string; suggestions: ChatSuggestion[]; usage: ChatUsage }> {
  const res = await authedFetch('/api/chat/message', { messages })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not reach the coach')
  }
  if (!res.body) throw new Error('Could not reach the coach')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue

      let event: { type: string; message?: string; error?: string; reply?: string; suggestions?: ChatSuggestion[]; usage?: ChatUsage }
      try {
        event = JSON.parse(line)
      } catch {
        continue // a malformed line shouldn't take down an otherwise-good stream
      }

      if (event.type === 'status') {
        if (event.message) onStatus?.(event.message)
      } else if (event.type === 'done') {
        return { reply: event.reply || '', suggestions: event.suggestions || [], usage: event.usage as ChatUsage }
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Could not reach the coach')
      }
    }
  }

  throw new Error('Coach response ended unexpectedly')
}

export async function applyWeightSuggestion(exerciseCode: string, weight: number): Promise<void> {
  const res = await authedFetch('/api/chat/apply-weight', { exerciseCode, weight })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not send the weight update')
  }
}

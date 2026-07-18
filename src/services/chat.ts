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

export async function sendChatMessage(
  messages: ChatMessage[]
): Promise<{ reply: string; suggestions: ChatSuggestion[]; usage: ChatUsage }> {
  const res = await authedFetch('/api/chat/message', { messages })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not reach the coach')
  return data
}

export async function applyWeightSuggestion(exerciseCode: string, weight: number): Promise<void> {
  const res = await authedFetch('/api/chat/apply-weight', { exerciseCode, weight })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not send the weight update')
  }
}

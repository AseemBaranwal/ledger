import { supabase } from './supabaseClient'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSuggestion {
  // Absent on suggestions saved before this field existed — treat as
  // 'adjustment', the only kind that used to exist.
  kind?: 'adjustment' | 'swap'
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
  // catalog by the time the suggestion reaches the client
  newExerciseCode?: string
  newExerciseName?: string
  // Persisted server-side once the user taps Accept/Dismiss (see
  // update-suggestion-status.ts) — absent on suggestions saved before this
  // field existed, or on a fresh suggestion that hasn't been acted on yet;
  // callers should default a missing value to 'pending'.
  status?: 'pending' | 'accepted' | 'dismissed'
}

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  dailyUsed: number
  dailyLimit: number
  dailyInputTokens: number
  dailyOutputTokens: number
  dailyCacheReadTokens: number
  dailyCacheCreationTokens: number
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
): Promise<{ reply: string; suggestions: ChatSuggestion[]; usage: ChatUsage; userMessageId: number | null; assistantMessageId: number | null }> {
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

      let event: {
        type: string
        message?: string
        error?: string
        reply?: string
        suggestions?: ChatSuggestion[]
        usage?: ChatUsage
        userMessageId?: number | null
        assistantMessageId?: number | null
      }
      try {
        event = JSON.parse(line)
      } catch {
        continue // a malformed line shouldn't take down an otherwise-good stream
      }

      if (event.type === 'status') {
        if (event.message) onStatus?.(event.message)
      } else if (event.type === 'done') {
        return {
          reply: event.reply || '',
          suggestions: event.suggestions || [],
          usage: event.usage as ChatUsage,
          userMessageId: event.userMessageId ?? null,
          assistantMessageId: event.assistantMessageId ?? null,
        }
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Could not reach the coach')
      }
    }
  }

  throw new Error('Coach response ended unexpectedly')
}

export interface ExerciseChange {
  weight?: number
  reps?: number
  sets?: number
}

export async function applyExerciseChange(exerciseCode: string, changes: ExerciseChange): Promise<void> {
  const res = await authedFetch('/api/chat/apply-exercise-change', { exerciseCode, ...changes })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not send the update')
  }
}

// Best-effort from the caller's perspective (see chatStore.ts) — the local
// suggestion-card status already updated before this is called, so a
// failure here just means the choice won't survive a reload, not that the
// accept/dismiss itself failed.
export async function updateSuggestionStatus(
  messageId: number,
  suggestionIndex: number,
  status: 'accepted' | 'dismissed'
): Promise<void> {
  const res = await authedFetch('/api/chat/update-suggestion-status', { messageId, suggestionIndex, status })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not save suggestion status')
  }
}

export interface ExerciseSubstitution {
  code: string
  name: string
  group: string
  unit: string
}

// Fetches the current standing substitutions (original code -> replacement)
// so the client can apply them at session-start time. Fails soft (empty
// map) — a hiccup here shouldn't block the app from loading.
export async function fetchExerciseSubstitutions(): Promise<Record<string, ExerciseSubstitution>> {
  try {
    const res = await authedGet('/api/chat/apply-exercise-swap')
    if (!res.ok) return {}
    const data = await res.json().catch(() => ({}))
    return data.substitutions || {}
  } catch {
    return {}
  }
}

export async function applyExerciseSwap(originalCode: string, replacement: ExerciseSubstitution): Promise<void> {
  const res = await authedFetch('/api/chat/apply-exercise-swap', {
    originalCode,
    newCode: replacement.code,
    newName: replacement.name,
    newGroup: replacement.group,
    newUnit: replacement.unit,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not save the swap')
  }
}

// Removes a turn from the durable conversation so it stops being sent as
// context on future turns — not just hidden client-side. Best-effort from
// the caller's perspective in the sense that the local UI removal always
// happens regardless (see chatStore.deleteExchange); this just keeps the
// server copy in sync so it doesn't reappear on the next reload/device.
export async function deleteChatMessages(ids: number[]): Promise<void> {
  if (!ids.length) return
  const res = await authedFetch('/api/chat/delete-message', { ids })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Could not delete the message')
  }
}

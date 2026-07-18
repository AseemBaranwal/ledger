import { supabaseAdmin } from './supabaseAdmin.js'

// Durable conversation storage — see supabase/chat_messages.sql. Distinct
// from chat_logs (metrics/rate-limiting only). This is what makes the coach
// remember past turns across a page reload or a different device, instead
// of being stuck in whatever a single browser's localStorage happened to
// cache. The client still caps what it actually SENDS to the model each
// turn (MAX_MESSAGES_SENT in chatStore.ts) — storing more history here
// doesn't grow the context window sent to Anthropic, it only grows what's
// available to scroll back through and what a future turn can slice from.

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  suggestions: unknown | null
}

// Best-effort — a storage hiccup must never fail the chat response the user
// already received. Runs after the model has already replied, so there's
// nothing useful to roll back if this fails; it just means that one turn
// won't show up on reload/another device, which self-heals next message.
export async function saveChatTurn(
  userId: string,
  userText: string,
  assistantReply: string,
  suggestions: unknown[]
): Promise<void> {
  try {
    // See exchange.ts for why this cast is needed — no generated Database
    // type, so supabase-js can't infer chat_messages' row shape.
    await (supabaseAdmin().from('chat_messages') as any).insert([
      { user_id: userId, role: 'user', content: userText, suggestions: null },
      { user_id: userId, role: 'assistant', content: assistantReply, suggestions: suggestions.length ? suggestions : null },
    ])
  } catch {
    // ignore
  }
}

export async function fetchChatHistory(userId: string, limit: number): Promise<StoredMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from('chat_messages')
    .select('id, role, content, suggestions')
    .eq('user_id', userId)
    .order('id', { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return (data as StoredMessage[]).reverse()
}

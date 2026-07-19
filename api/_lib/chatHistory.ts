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
// Returns the two new row ids (null on failure) so the client can target
// this exact turn for deletion later without needing a separate lookup.
export async function saveChatTurn(
  userId: string,
  userText: string,
  assistantReply: string,
  suggestions: unknown[]
): Promise<{ userMessageId: number; assistantMessageId: number } | null> {
  try {
    // See exchange.ts for why this cast is needed — no generated Database
    // type, so supabase-js can't infer chat_messages' row shape.
    const { data, error } = await (supabaseAdmin().from('chat_messages') as any)
      .insert([
        { user_id: userId, role: 'user', content: userText, suggestions: null },
        { user_id: userId, role: 'assistant', content: assistantReply, suggestions: suggestions.length ? suggestions : null },
      ])
      .select('id')
    if (error || !data || data.length !== 2) return null
    return { userMessageId: data[0].id, assistantMessageId: data[1].id }
  } catch {
    return null
  }
}

// Scoped to the caller's own user_id even though supabaseAdmin() bypasses
// RLS — this is a service-role client, so the ownership check has to be
// explicit in the query rather than relying on the database to enforce it.
export async function deleteChatMessages(userId: string, ids: number[]): Promise<void> {
  if (!ids.length) return
  try {
    await supabaseAdmin().from('chat_messages').delete().eq('user_id', userId).in('id', ids)
  } catch {
    // ignore — best-effort, same reasoning as saveChatTurn
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

// Patches one suggestion's status within a stored message's `suggestions`
// array — read-modify-write since Supabase's JS client has no partial-jsonb-
// array-element update. Called right after the user taps Accept/Dismiss on
// a suggestion card, so the choice survives a reload or a different device
// instead of every suggestion silently reverting to "pending" the next time
// loadHistory() runs (which is exactly what happened before this existed —
// the client only ever tracked status in local zustand state, and the
// initial save from saveChatTurn() never included one).
export async function updateSuggestionStatus(
  userId: string,
  messageId: number,
  suggestionIndex: number,
  status: 'accepted' | 'dismissed'
): Promise<boolean> {
  try {
    const { data, error } = await (supabaseAdmin().from('chat_messages') as any)
      .select('suggestions')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single()
    if (error || !data || !Array.isArray(data.suggestions) || !data.suggestions[suggestionIndex]) return false

    const suggestions = [...data.suggestions]
    suggestions[suggestionIndex] = { ...suggestions[suggestionIndex], status }

    const { error: updateError } = await (supabaseAdmin().from('chat_messages') as any)
      .update({ suggestions })
      .eq('id', messageId)
      .eq('user_id', userId)
    return !updateError
  } catch {
    return false
  }
}

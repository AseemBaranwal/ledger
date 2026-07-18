import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { scopedStorage } from '@/services/userScope'
import {
  sendChatMessage,
  applyWeightSuggestion,
  fetchChatHistory,
  deleteChatMessages,
  type ChatMessage,
  type ChatSuggestion,
  type ChatUsage,
} from '@/services/chat'
import { useConfigStore } from './configStore'

// A message the UI has fully rendered — extends the wire ChatMessage with a
// stable local id and (for assistant turns) the suggestions that came back
// alongside it, plus per-suggestion accept/dismiss state. serverId is the
// row id in chat_messages once known (either loaded from history, or
// filled in right after a send completes) — deleteExchange needs it to
// remove the row server-side, not just from local state.
export interface DisplayMessage extends ChatMessage {
  id: string
  serverId?: number
  suggestions?: (ChatSuggestion & { status: 'pending' | 'accepted' | 'dismissed' })[]
}

// The API is stateless — every call resends history. Sending the FULL
// scrollback would grow unboundedly, so only the last N messages go out per
// turn; everything stays in the UI for scrollback regardless.
const MAX_MESSAGES_SENT = 24

interface ChatStore {
  messages: DisplayMessage[]
  sending: boolean
  statusMessage: string | null
  lastUsage: ChatUsage | null
  error: string | null

  sendMessage: (text: string) => Promise<void>
  loadHistory: () => Promise<void>
  deleteExchange: (messageId: string) => Promise<void>
  acceptSuggestion: (messageId: string, suggestionIndex: number, weight: number) => Promise<void>
  dismissSuggestion: (messageId: string, suggestionIndex: number) => void
  clearError: () => void
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [],
      sending: false,
      statusMessage: null,
      lastUsage: null,
      error: null,

      sendMessage: async (text) => {
        const trimmed = text.trim()
        if (!trimmed || get().sending) return

        const userMessage: DisplayMessage = { id: makeId(), role: 'user', content: trimmed }
        set((state) => ({ messages: [...state.messages, userMessage], sending: true, error: null, statusMessage: 'Thinking…' }))

        try {
          const history = get()
            .messages.slice(-MAX_MESSAGES_SENT)
            .map((m) => ({ role: m.role, content: m.content }))

          const { reply, suggestions, usage, userMessageId, assistantMessageId } = await sendChatMessage(history, (status) =>
            set({ statusMessage: status })
          )

          const assistantMessage: DisplayMessage = {
            id: makeId(),
            serverId: assistantMessageId ?? undefined,
            role: 'assistant',
            content: reply,
            suggestions: suggestions.length ? suggestions.map((s) => ({ ...s, status: 'pending' as const })) : undefined,
          }
          set((state) => ({
            // Now that the turn has round-tripped, attach the real server id
            // to the user message too (it was sent with none, since it
            // didn't exist server-side until this response came back) —
            // needed so deleteExchange can target it without a reload.
            messages: [
              ...state.messages.map((m) => (m.id === userMessage.id ? { ...m, serverId: userMessageId ?? undefined } : m)),
              assistantMessage,
            ],
            sending: false,
            statusMessage: null,
            lastUsage: usage,
          }))
        } catch (e) {
          set({ sending: false, statusMessage: null, error: e instanceof Error ? e.message : 'Could not reach the coach' })
        }
      },

      // Called once when the Coach tab mounts. Refreshes from the durable
      // server copy so a reload — or opening the app on a different device —
      // shows the real conversation instead of whatever this one browser's
      // local cache happened to have. Skipped while a send is in flight: if
      // the tab was left mid-turn and reopened, overwriting messages here
      // would wipe the optimistic user message that hasn't round-tripped
      // yet — it'll just pick up the fresh copy on the next mount instead.
      loadHistory: async () => {
        if (get().sending) return
        try {
          const history = await fetchChatHistory()
          if (!history.length) return
          const mapped: DisplayMessage[] = history.map((m) => ({
            id: `srv-${m.id}`,
            serverId: m.id,
            role: m.role,
            content: m.content,
            suggestions: m.suggestions?.length ? m.suggestions.map((s) => ({ ...s, status: 'pending' as const })) : undefined,
          }))
          set({ messages: mapped })
        } catch {
          // best-effort — keep whatever's cached locally (e.g. offline)
        }
      },

      // Removes a whole exchange (the user question + its paired assistant
      // reply) — deleting just one half would leave a dangling orphaned
      // message. Local removal happens immediately and unconditionally, so
      // the deleted turn stops being sent as context on the very next
      // message regardless of whether the server delete succeeds — that's
      // the actual point (excluding it from future context), persistence
      // is secondary.
      deleteExchange: async (messageId) => {
        const messages = get().messages
        const index = messages.findIndex((m) => m.id === messageId)
        if (index === -1) return

        const target = messages[index]
        const partner =
          target.role === 'user' && messages[index + 1]?.role === 'assistant'
            ? messages[index + 1]
            : target.role === 'assistant' && messages[index - 1]?.role === 'user'
              ? messages[index - 1]
              : null

        const idsToRemove = new Set([target.id, partner?.id].filter(Boolean) as string[])
        const serverIds = [target.serverId, partner?.serverId].filter((id): id is number => typeof id === 'number')

        set((state) => ({ messages: state.messages.filter((m) => !idsToRemove.has(m.id)) }))

        if (serverIds.length) {
          try {
            await deleteChatMessages(serverIds)
          } catch (e) {
            // The local removal already happened and already achieved the
            // main goal (excluded from future context) — surface this as a
            // heads-up, not a blocking failure, since retrying just means
            // clicking delete again.
            set({ error: e instanceof Error ? e.message : 'Removed locally, but could not delete on the server' })
          }
        }
      },

      acceptSuggestion: async (messageId, suggestionIndex, weight) => {
        const message = get().messages.find((m) => m.id === messageId)
        const suggestion = message?.suggestions?.[suggestionIndex]
        if (!suggestion) return

        try {
          await applyWeightSuggestion(suggestion.exerciseCode, weight)

          // Optimistic local update — same in-place mutation pattern
          // configStore.loadWeights() already uses, so the new target shows
          // up immediately without waiting for a fresh sheet pull.
          useConfigStore.setState((state) => {
            const program = { ...state.program }
            Object.values(program).forEach((session) => {
              session.ex?.forEach((ex) => {
                if (ex.k === suggestion.exerciseCode) ex.w = weight
              })
            })
            return { program }
          })

          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId
                ? { ...m, suggestions: m.suggestions?.map((s, i) => (i === suggestionIndex ? { ...s, status: 'accepted' as const } : s)) }
                : m
            ),
          }))
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not send the weight update' })
        }
      },

      dismissSuggestion: (messageId, suggestionIndex) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === messageId
              ? { ...m, suggestions: m.suggestions?.map((s, i) => (i === suggestionIndex ? { ...s, status: 'dismissed' as const } : s)) }
              : m
          ),
        }))
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'ledger.chat',
      storage: createJSONStorage(() => scopedStorage),
      partialize: (state) => ({ messages: state.messages }),
    }
  )
)

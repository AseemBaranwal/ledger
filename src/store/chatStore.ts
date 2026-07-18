import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { scopedStorage } from '@/services/userScope'
import { sendChatMessage, applyWeightSuggestion, type ChatMessage, type ChatSuggestion, type ChatUsage } from '@/services/chat'
import { useConfigStore } from './configStore'

// A message the UI has fully rendered — extends the wire ChatMessage with a
// stable local id and (for assistant turns) the suggestions that came back
// alongside it, plus per-suggestion accept/dismiss state.
export interface DisplayMessage extends ChatMessage {
  id: string
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

          const { reply, suggestions, usage } = await sendChatMessage(history, (status) => set({ statusMessage: status }))

          const assistantMessage: DisplayMessage = {
            id: makeId(),
            role: 'assistant',
            content: reply,
            suggestions: suggestions.length ? suggestions.map((s) => ({ ...s, status: 'pending' as const })) : undefined,
          }
          set((state) => ({ messages: [...state.messages, assistantMessage], sending: false, statusMessage: null, lastUsage: usage }))
        } catch (e) {
          set({ sending: false, statusMessage: null, error: e instanceof Error ? e.message : 'Could not reach the coach' })
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

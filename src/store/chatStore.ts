import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { scopedStorage } from '@/services/userScope'
import {
  sendChatMessage,
  applyExerciseChange,
  applyExerciseSwap,
  updateSuggestionStatus,
  fetchChatHistory,
  deleteChatMessages,
  type ChatMessage,
  type ChatSuggestion,
  type ChatUsage,
  type ExerciseChange,
} from '@/services/chat'
import { toProgramExercise } from '@/services/exerciseCatalog'
import { lastOf } from '@/services/trendCalculations'
import { useConfigStore } from './configStore'
import { useSessionStore } from './sessionStore'

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
  acceptSuggestion: (messageId: string, suggestionIndex: number, changes: ExerciseChange) => Promise<void>
  acceptSwap: (messageId: string, suggestionIndex: number) => Promise<void>
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
            // Trust a persisted status if one exists (see
            // update-suggestion-status.ts) — only default to 'pending' for
            // suggestions saved before that existed, or genuinely untouched.
            suggestions: m.suggestions?.length ? m.suggestions.map((s) => ({ ...s, status: s.status ?? 'pending' })) : undefined,
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

      // Covers weight, reps, and/or sets changes — `changes` only carries
      // whichever field(s) the accepted suggestion actually proposed.
      // Always writes through to the Sheet (the durable "next time" target,
      // same as weight-only suggestions always have), and additionally
      // syncs the live draft session if one is active and has this
      // exercise, so the change is visible immediately without restarting.
      acceptSuggestion: async (messageId, suggestionIndex, changes) => {
        const message = get().messages.find((m) => m.id === messageId)
        const suggestion = message?.suggestions?.[suggestionIndex]
        if (!suggestion) return

        try {
          await applyExerciseChange(suggestion.exerciseCode, changes)

          // Optimistic local update — same in-place mutation pattern
          // configStore.loadWeights() already uses, so the new target shows
          // up immediately without waiting for a fresh sheet pull.
          useConfigStore.setState((state) => {
            const program = { ...state.program }
            Object.values(program).forEach((session) => {
              session.ex?.forEach((ex) => {
                if (ex.k !== suggestion.exerciseCode) return
                if (changes.weight != null) ex.w = changes.weight
                if (changes.reps != null) ex.r = changes.reps
                if (changes.sets != null) ex.s = changes.sets
              })
            })
            return { program }
          })

          const { draftDefs, setWeight, updateExerciseTarget } = useSessionStore.getState()
          const activeIndex = draftDefs?.findIndex((d) => d.k === suggestion.exerciseCode) ?? -1
          if (activeIndex !== -1) {
            if (changes.weight != null) setWeight(activeIndex, changes.weight)
            if (changes.reps != null || changes.sets != null) {
              updateExerciseTarget(activeIndex, {
                ...(changes.reps != null ? { r: changes.reps } : {}),
                ...(changes.sets != null ? { s: changes.sets } : {}),
              })
            }
          }

          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId
                ? { ...m, suggestions: m.suggestions?.map((s, i) => (i === suggestionIndex ? { ...s, status: 'accepted' as const } : s)) }
                : m
            ),
          }))
          // Best-effort — the accept already fully happened above; this
          // only affects whether the card still shows "accepted" after a
          // reload, not whether the change itself took hold.
          if (message?.serverId != null) {
            updateSuggestionStatus(message.serverId, suggestionIndex, 'accepted').catch(() => {})
          }
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not send the update' })
        }
      },

      // Exercise swaps have no config.json-level storage (that file is
      // genuinely static, not writable by this app) — so a swap is instead
      // recorded as a standing substitution on the user's profile (see
      // supabase/exercise_substitutions.sql), applied at session-start time
      // for every future occurrence of the original exercise, exactly like
      // weight/reps/sets suggestions are a persistent "next time" target.
      // On top of that persistent write, if a session is open RIGHT NOW
      // with the original exercise active, the swap also applies to that
      // live draft immediately — so accepting works the same way whether
      // or not you happen to be mid-session when you ask for it.
      acceptSwap: async (messageId, suggestionIndex) => {
        const message = get().messages.find((m) => m.id === messageId)
        const suggestion = message?.suggestions?.[suggestionIndex]
        if (!suggestion || !suggestion.newExerciseCode) return

        const newDef = toProgramExercise(suggestion.newExerciseCode, { n: suggestion.newExerciseName })
        const replacement = { code: newDef.k, name: newDef.n, group: newDef.group, unit: newDef.u }

        // If exerciseCode is itself a currently-substituted-TO code (e.g.
        // this is the second swap in a chain — SQ was already substituted
        // with LEG_PRESS, and this suggestion swaps LEG_PRESS for something
        // else), anchor the write to the ORIGINAL program code instead.
        // Substitutions are looked up at session-start against the static
        // program's real codes (see TodayTab's withSubstitutions) — storing
        // this under the intermediate code would create an entry nothing
        // ever checks, silently no-op'ing every swap after the first one.
        const existingSubstitutions = useConfigStore.getState().substitutions
        const anchorCode =
          Object.keys(existingSubstitutions).find((original) => existingSubstitutions[original].code === suggestion.exerciseCode) ??
          suggestion.exerciseCode

        try {
          await applyExerciseSwap(anchorCode, replacement)
          useConfigStore.getState().setSubstitution(anchorCode, replacement)

          const { draftDefs, sessions, swapExercise } = useSessionStore.getState()
          const activeIndex = draftDefs?.findIndex((d) => d.k === suggestion.exerciseCode) ?? -1
          if (activeIndex !== -1 && draftDefs) {
            // Prefer the live program target (freshest — reflects any
            // weight change accepted earlier in this same conversation)
            // over historical session logs, which wouldn't see a Sheet
            // update that just happened via chat.
            const { program } = useConfigStore.getState()
            const programMatch = Object.values(program)
              .flatMap((p) => p.ex)
              .find((e) => e.k === newDef.k)
            const last = lastOf(sessions, newDef.k)
            const startWeight = programMatch?.w ?? (last ? (last.ws?.length ? Math.max(...last.ws) : (last.w ?? 0)) : 0)
            swapExercise(activeIndex, newDef, startWeight)
          }

          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId
                ? { ...m, suggestions: m.suggestions?.map((s, i) => (i === suggestionIndex ? { ...s, status: 'accepted' as const } : s)) }
                : m
            ),
          }))
          if (message?.serverId != null) {
            updateSuggestionStatus(message.serverId, suggestionIndex, 'accepted').catch(() => {})
          }
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Could not save the swap' })
        }
      },

      dismissSuggestion: (messageId, suggestionIndex) => {
        const message = get().messages.find((m) => m.id === messageId)
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === messageId
              ? { ...m, suggestions: m.suggestions?.map((s, i) => (i === suggestionIndex ? { ...s, status: 'dismissed' as const } : s)) }
              : m
          ),
        }))
        if (message?.serverId != null) {
          updateSuggestionStatus(message.serverId, suggestionIndex, 'dismissed').catch(() => {})
        }
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

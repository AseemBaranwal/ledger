import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore } from '@/store/chatStore'
import * as chatService from '@/services/chat'

vi.mock('@/services/chat', () => ({
  sendChatMessage: vi.fn(),
  applyWeightSuggestion: vi.fn(),
  fetchChatHistory: vi.fn(),
  deleteChatMessages: vi.fn(),
}))

const baseUsage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  dailyUsed: 1,
  dailyLimit: 60,
  dailyInputTokens: 10,
  dailyOutputTokens: 5,
  dailyCacheReadTokens: 0,
  dailyCacheCreationTokens: 0,
}

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [], sending: false, statusMessage: null, lastUsage: null, error: null })
    vi.clearAllMocks()
  })

  describe('sendMessage', () => {
    it('appends the user message optimistically, then the assistant reply with server ids attached', async () => {
      vi.mocked(chatService.sendChatMessage).mockResolvedValue({
        reply: 'Looks solid.',
        suggestions: [],
        usage: baseUsage,
        userMessageId: 101,
        assistantMessageId: 102,
      })

      await useChatStore.getState().sendMessage("How's my squat trending?")

      const { messages, sending, lastUsage } = useChatStore.getState()
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ role: 'user', content: "How's my squat trending?", serverId: 101 })
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Looks solid.', serverId: 102 })
      expect(sending).toBe(false)
      expect(lastUsage).toEqual(baseUsage)
    })

    it('attaches suggestions with pending status to the assistant message', async () => {
      vi.mocked(chatService.sendChatMessage).mockResolvedValue({
        reply: 'Consider a bump.',
        suggestions: [{ exerciseCode: 'SQ', exerciseName: 'Back Squat', currentWeight: 80, suggestedWeight: 85, reasoning: 'Hit every rep.' }],
        usage: baseUsage,
        userMessageId: 1,
        assistantMessageId: 2,
      })

      await useChatStore.getState().sendMessage('Any suggestions?')

      const assistantMessage = useChatStore.getState().messages[1]
      expect(assistantMessage.suggestions).toHaveLength(1)
      expect(assistantMessage.suggestions![0].status).toBe('pending')
    })

    it('sets an error and clears sending on failure, without adding an assistant message', async () => {
      vi.mocked(chatService.sendChatMessage).mockRejectedValue(new Error('Daily message limit reached'))

      await useChatStore.getState().sendMessage('Hello?')

      const { messages, sending, error } = useChatStore.getState()
      expect(messages).toHaveLength(1) // the optimistic user message stays; no assistant reply
      expect(sending).toBe(false)
      expect(error).toBe('Daily message limit reached')
    })

    it('ignores an empty/whitespace-only message', async () => {
      await useChatStore.getState().sendMessage('   ')
      expect(chatService.sendChatMessage).not.toHaveBeenCalled()
    })

    it('ignores a send while one is already in flight', async () => {
      useChatStore.setState({ sending: true })
      await useChatStore.getState().sendMessage('Another question')
      expect(chatService.sendChatMessage).not.toHaveBeenCalled()
    })
  })

  describe('loadHistory', () => {
    it('replaces local messages with the server history, tagging each with its real server id', async () => {
      vi.mocked(chatService.fetchChatHistory).mockResolvedValue([
        { id: 5, role: 'user', content: 'Old question', suggestions: null },
        { id: 6, role: 'assistant', content: 'Old answer', suggestions: null },
      ])

      await useChatStore.getState().loadHistory()

      const { messages } = useChatStore.getState()
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ serverId: 5, role: 'user', content: 'Old question' })
      expect(messages[1]).toMatchObject({ serverId: 6, role: 'assistant', content: 'Old answer' })
    })

    it('keeps whatever local state exists when the server has no history yet', async () => {
      const localMessage = { id: 'local-1', role: 'user' as const, content: 'Not yet synced' }
      useChatStore.setState({ messages: [localMessage] })
      vi.mocked(chatService.fetchChatHistory).mockResolvedValue([])

      await useChatStore.getState().loadHistory()

      expect(useChatStore.getState().messages).toEqual([localMessage])
    })

    it('does not refresh while a send is already in flight, to avoid wiping the optimistic message', async () => {
      useChatStore.setState({ sending: true })
      await useChatStore.getState().loadHistory()
      expect(chatService.fetchChatHistory).not.toHaveBeenCalled()
    })
  })

  describe('deleteExchange', () => {
    it('removes both the user message and its paired assistant reply, and deletes both server-side', async () => {
      useChatStore.setState({
        messages: [
          { id: 'u1', serverId: 10, role: 'user', content: 'Q1' },
          { id: 'a1', serverId: 11, role: 'assistant', content: 'A1' },
          { id: 'u2', serverId: 12, role: 'user', content: 'Q2' },
          { id: 'a2', serverId: 13, role: 'assistant', content: 'A2' },
        ],
      })

      await useChatStore.getState().deleteExchange('u1')

      const { messages } = useChatStore.getState()
      expect(messages.map((m) => m.id)).toEqual(['u2', 'a2'])
      expect(chatService.deleteChatMessages).toHaveBeenCalledWith([10, 11])
    })

    it('works from the assistant side of the pair too', async () => {
      useChatStore.setState({
        messages: [
          { id: 'u1', serverId: 10, role: 'user', content: 'Q1' },
          { id: 'a1', serverId: 11, role: 'assistant', content: 'A1' },
        ],
      })

      await useChatStore.getState().deleteExchange('a1')

      expect(useChatStore.getState().messages).toHaveLength(0)
      // Order depends on which side of the pair triggered the delete —
      // irrelevant for a `DELETE WHERE id IN (...)` query, so just check
      // the set of ids, not the order.
      expect(vi.mocked(chatService.deleteChatMessages).mock.calls[0][0].sort()).toEqual([10, 11])
    })

    it('removes a lone unpaired message locally without crashing (e.g. a failed send with no assistant reply)', async () => {
      useChatStore.setState({ messages: [{ id: 'u1', serverId: 10, role: 'user', content: 'Never answered' }] })

      await useChatStore.getState().deleteExchange('u1')

      expect(useChatStore.getState().messages).toHaveLength(0)
      expect(chatService.deleteChatMessages).toHaveBeenCalledWith([10])
    })

    it('skips the server call entirely when neither message has a server id yet', async () => {
      useChatStore.setState({ messages: [{ id: 'u1', role: 'user', content: 'Not synced yet' }] })

      await useChatStore.getState().deleteExchange('u1')

      expect(useChatStore.getState().messages).toHaveLength(0)
      expect(chatService.deleteChatMessages).not.toHaveBeenCalled()
    })

    it('is a no-op for an id that does not exist', async () => {
      const messages = [{ id: 'u1', role: 'user' as const, content: 'Q1' }]
      useChatStore.setState({ messages })

      await useChatStore.getState().deleteExchange('does-not-exist')

      expect(useChatStore.getState().messages).toEqual(messages)
    })
  })

  describe('acceptSuggestion / dismissSuggestion', () => {
    beforeEach(() => {
      useChatStore.setState({
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            content: 'Suggestion inside',
            suggestions: [{ exerciseCode: 'SQ', exerciseName: 'Back Squat', currentWeight: 80, suggestedWeight: 85, reasoning: 'x', status: 'pending' }],
          },
        ],
      })
    })

    it('marks a suggestion accepted after the weight update succeeds', async () => {
      vi.mocked(chatService.applyWeightSuggestion).mockResolvedValue(undefined)

      await useChatStore.getState().acceptSuggestion('a1', 0, 85)

      expect(useChatStore.getState().messages[0].suggestions![0].status).toBe('accepted')
      expect(chatService.applyWeightSuggestion).toHaveBeenCalledWith('SQ', 85)
    })

    it('leaves the suggestion pending and sets an error when the weight update fails', async () => {
      vi.mocked(chatService.applyWeightSuggestion).mockRejectedValue(new Error('Sheet unreachable'))

      await useChatStore.getState().acceptSuggestion('a1', 0, 85)

      expect(useChatStore.getState().messages[0].suggestions![0].status).toBe('pending')
      expect(useChatStore.getState().error).toBe('Sheet unreachable')
    })

    it('marks a suggestion dismissed locally, with no network call', () => {
      useChatStore.getState().dismissSuggestion('a1', 0)

      expect(useChatStore.getState().messages[0].suggestions![0].status).toBe('dismissed')
      expect(chatService.applyWeightSuggestion).not.toHaveBeenCalled()
    })
  })
})

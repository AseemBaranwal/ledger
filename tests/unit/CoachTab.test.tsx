import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoachTab } from '@/components/tabs/CoachTab'
import { useChatStore } from '@/store/chatStore'
import * as chatService from '@/services/chat'

// jsdom doesn't implement scrollIntoView — CoachTab calls it on every
// messages/sending/thinking update to keep the latest content in view.
Element.prototype.scrollIntoView = vi.fn()

vi.mock('@/services/chat', () => ({
  sendChatMessage: vi.fn(),
  applyExerciseChange: vi.fn(),
  applyExerciseSwap: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  fetchChatHistory: vi.fn(),
  deleteChatMessages: vi.fn(),
}))

describe('CoachTab — generating blob', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [], sending: false, statusMessage: null, thinkingText: '', lastUsage: null, error: null })
    vi.mocked(chatService.fetchChatHistory).mockResolvedValue([])
  })

  // Previously a static "Thinking…" label with no way to see what the model
  // was actually doing. Each tool-loop iteration's (summarized) reasoning
  // now streams to the client — surfaced here as a collapsible disclosure,
  // collapsed by default so it doesn't clutter the common case.
  it('shows the status line but keeps thinking content collapsed by default', () => {
    useChatStore.setState({ sending: true, statusMessage: 'Checking your training data…', thinkingText: 'Looking at recent squat sessions.' })
    render(<CoachTab />)

    expect(screen.getByText('Checking your training data…')).toBeTruthy()
    expect(screen.queryByText('Looking at recent squat sessions.')).toBeNull()
  })

  it('reveals thinking content when the disclosure is tapped', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ sending: true, statusMessage: 'Thinking…', thinkingText: 'Looking at recent squat sessions.' })
    render(<CoachTab />)

    await user.click(screen.getByText('Thinking…'))

    expect(screen.getByText('Looking at recent squat sessions.')).toBeTruthy()
  })

  // "if not, its fine" — a call with no thinking content at all (or not yet
  // arrived) should degrade to a plain, non-interactive status line, not a
  // dead toggle with nothing behind it.
  it('has no disclosure toggle at all when there is no thinking content yet', () => {
    useChatStore.setState({ sending: true, statusMessage: 'Thinking…', thinkingText: '' })
    render(<CoachTab />)

    const statusButton = screen.getByText('Thinking…').closest('button')!
    expect(statusButton.style.cursor).toBe('default')
  })

  it('shows nothing at all once sending has finished', () => {
    useChatStore.setState({ sending: false, statusMessage: null, thinkingText: '' })
    render(<CoachTab />)

    expect(screen.queryByText('Thinking…')).toBeNull()
  })
})

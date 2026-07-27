import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useActiveSessionBackGuard } from '@/hooks/useActiveSessionBackGuard'
import { useSessionStore } from '@/store/sessionStore'

describe('useActiveSessionBackGuard', () => {
  beforeEach(() => {
    useSessionStore.setState({ draft: null, draftEx: null, draftDefs: null, draftItems: null })
    // Reset to a known history depth so pushState-count assertions are stable.
    window.history.replaceState(null, '')
  })

  it('does nothing when there is no active draft', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    renderHook(() => useActiveSessionBackGuard())
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('pushes one history entry when a draft session becomes active', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    useSessionStore.setState({ draft: { d: '2026-07-26', s: 'LA', type: 'PROGRAM' } })
    renderHook(() => useActiveSessionBackGuard())
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('re-pushes on popstate while the draft is still active, absorbing the back tap', () => {
    useSessionStore.setState({ draft: { d: '2026-07-26', s: 'LA', type: 'PROGRAM' } })
    renderHook(() => useActiveSessionBackGuard())
    const pushSpy = vi.spyOn(window.history, 'pushState')

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('does not re-push on popstate once the draft has ended', () => {
    useSessionStore.setState({ draft: { d: '2026-07-26', s: 'LA', type: 'PROGRAM' } })
    renderHook(() => useActiveSessionBackGuard())
    act(() => { useSessionStore.setState({ draft: null }) })
    const pushSpy = vi.spyOn(window.history, 'pushState')

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(pushSpy).not.toHaveBeenCalled()
  })
})

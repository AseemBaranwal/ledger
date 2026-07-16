import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '@/store/sessionStore'
import { useUIStore } from '@/store/uiStore'

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], draft: null, draftEx: null, draftItems: null })
  })

  it('should start a PROGRAM session and populate draftEx', () => {
    useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2')
    const state = useSessionStore.getState()
    expect(state.draft?.s).toBe('LA')
    expect(state.draftEx).toHaveLength(1)
    expect(state.draftEx![0]).toMatchObject({ k: 'SQ', w: 75, r: [] })
  })

  it('should log a rep and track weight per set', () => {
    useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2')
    useSessionStore.getState().logRep(0, 6)
    const ex = useSessionStore.getState().draftEx![0]
    expect(ex.r).toEqual([6])
    expect(ex.ws).toEqual([75])
  })

  it('should clear the draft', () => {
    useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2')
    useSessionStore.getState().clearDraft()
    const state = useSessionStore.getState()
    expect(state.draft).toBeNull()
    expect(state.draftEx).toBeNull()
  })

  it('should save draft to sessions with only logged exercises', () => {
    useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2')
    useSessionStore.getState().logRep(0, 6)
    useSessionStore.getState().saveDraft()

    const state = useSessionStore.getState()
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].ex).toHaveLength(1)
    expect(state.draft).toBeNull()
  })

  it('should start a REST session and toggle item done state', () => {
    useSessionStore.getState().startRestSession(5, 'Full Rest', [{ n: 'Rest', d: 'all day' }])
    useSessionStore.getState().toggleRestItem(0)
    expect(useSessionStore.getState().draftItems![0].done).toBe(true)
  })
})

describe('uiStore', () => {
  it('should switch tabs', () => {
    useUIStore.getState().setTab('history')
    expect(useUIStore.getState().activeTab).toBe('history')
  })

  it('should show and dismiss notifications', () => {
    useUIStore.getState().showNotification('Test', 'success')
    expect(useUIStore.getState().notifications).toHaveLength(1)

    const id = useUIStore.getState().notifications[0].id
    useUIStore.getState().dismissNotification(id)
    expect(useUIStore.getState().notifications).toHaveLength(0)
  })
})

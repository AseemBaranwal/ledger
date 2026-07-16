import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '@/store/sessionStore'
import { useUIStore } from '@/store/uiStore'
import type { Session } from '@/types'

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], draft: null })
  })

  it('should add a session', () => {
    const session: Session = {
      d: '2026-07-15',
      s: 'LA',
      g: 'RSL2',
      ex: [],
      n: 'test',
    }
    useSessionStore.getState().addSession(session)
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })

  it('should create and clear draft', () => {
    const draft: Session = {
      d: '2026-07-15',
      s: 'LA',
      ex: [],
    }
    useSessionStore.getState().updateDraft(draft)
    expect(useSessionStore.getState().draft).toBe(draft)

    useSessionStore.getState().clearDraft()
    expect(useSessionStore.getState().draft).toBeNull()
  })

  it('should save draft to sessions', () => {
    const draft: Session = {
      d: '2026-07-15',
      s: 'LA',
      ex: [],
    }
    useSessionStore.getState().updateDraft(draft)
    useSessionStore.getState().saveDraft()

    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().draft).toBeNull()
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

import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '@/store/sessionStore'
import { useUIStore } from '@/store/uiStore'
import type { ProgramExercise } from '@/types'

const SQ_DEF: ProgramExercise = { k: 'SQ', n: 'Back Squat', s: 4, r: 6, w: 75, u: 'lb', group: 'Legs', cue: '' }
const LEG_PRESS_DEF: ProgramExercise = { k: 'LEG_PRESS', n: 'Leg Press', s: 3, r: 10, w: 0, u: 'lb', group: 'Legs', cue: '' }

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], draft: null, draftEx: null, draftDefs: null, draftItems: null })
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

  describe('exercise swap / add / remove', () => {
    it('populates draftDefs when defs are passed to startSession', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      expect(useSessionStore.getState().draftDefs).toEqual([SQ_DEF])
    })

    it('leaves draftDefs null when startSession is called without defs (back-compat)', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2')
      expect(useSessionStore.getState().draftDefs).toBeNull()
    })

    it('swaps an exercise in place, resetting its logged sets and using the new starting weight', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      useSessionStore.getState().logRep(0, 6) // log a set on the original exercise first
      useSessionStore.getState().swapExercise(0, LEG_PRESS_DEF, 180)

      const state = useSessionStore.getState()
      expect(state.draftDefs![0]).toEqual(LEG_PRESS_DEF)
      expect(state.draftEx![0]).toMatchObject({ k: 'LEG_PRESS', w: 180, r: [] })
    })

    it('appends a new exercise via addExercise', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      useSessionStore.getState().addExercise(LEG_PRESS_DEF, 180)

      const state = useSessionStore.getState()
      expect(state.draftDefs).toHaveLength(2)
      expect(state.draftEx).toHaveLength(2)
      expect(state.draftDefs![1]).toEqual(LEG_PRESS_DEF)
    })

    it('removes an unlogged exercise', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      useSessionStore.getState().addExercise(LEG_PRESS_DEF, 180)
      useSessionStore.getState().removeExercise(0)

      const state = useSessionStore.getState()
      expect(state.draftDefs).toHaveLength(1)
      expect(state.draftDefs![0]).toEqual(LEG_PRESS_DEF)
    })

    it('refuses to remove an exercise that already has logged sets', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      useSessionStore.getState().logRep(0, 6)
      useSessionStore.getState().removeExercise(0)

      expect(useSessionStore.getState().draftDefs).toHaveLength(1)
    })

    it('hydrateDraftDefs backfills a null draftDefs but is a no-op once populated', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2') // no defs passed
      useSessionStore.getState().hydrateDraftDefs([SQ_DEF])
      expect(useSessionStore.getState().draftDefs).toEqual([SQ_DEF])

      useSessionStore.getState().hydrateDraftDefs([LEG_PRESS_DEF])
      expect(useSessionStore.getState().draftDefs).toEqual([SQ_DEF]) // unchanged
    })

    it('clears draftDefs alongside the rest of the draft on save and discard', () => {
      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      useSessionStore.getState().logRep(0, 6)
      useSessionStore.getState().saveDraft()
      expect(useSessionStore.getState().draftDefs).toBeNull()

      useSessionStore.getState().startSession('LA', [{ k: 'SQ', w: 75 }], 'RSL2', [SQ_DEF])
      useSessionStore.getState().clearDraft()
      expect(useSessionStore.getState().draftDefs).toBeNull()
    })
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

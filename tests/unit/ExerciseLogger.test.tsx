import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExerciseLogger } from '@/components/session/ExerciseLogger'
import { useSessionStore } from '@/store/sessionStore'
import { useUIStore } from '@/store/uiStore'
import type { ProgramExercise } from '@/types'

const SQ_DEF: ProgramExercise = { k: 'SQ', n: 'Back Squat', s: 4, r: 6, w: 75, u: 'lb', group: 'Legs', cue: 'Depth over ego.' }

function setupDraft(overrides: Partial<{ r: number[]; ws: number[]; ef: Array<'e' | 'o' | 'h' | null> }> = {}) {
  useSessionStore.setState({
    sessions: [],
    draftEx: [{ k: 'SQ', w: 75, r: overrides.r ?? [], ws: overrides.ws ?? [], ef: overrides.ef }],
  })
}

describe('ExerciseLogger — accordion', () => {
  beforeEach(() => {
    useUIStore.setState({ openExerciseIndex: null, weightIncrement: 5 })
  })

  it('renders collapsed by default — name and progress pips, no stepper or set chips', () => {
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    expect(screen.getByText('Back Squat')).toBeTruthy()
    expect(screen.queryByText('Depth over ego.')).toBeNull()
    expect(screen.queryByText('Set 1')).toBeNull()
  })

  it('expands on tap to show the full controls, and preserves swap/remove', async () => {
    const user = userEvent.setup()
    setupDraft()
    const onSwap = vi.fn()
    const onRemove = vi.fn()
    render(<ExerciseLogger def={SQ_DEF} index={0} onRequestSwap={onSwap} onRequestRemove={onRemove} />)

    await user.click(screen.getByText('Back Squat'))

    expect(screen.getByText('Depth over ego.')).toBeTruthy()
    expect(screen.getByText('Set 1')).toBeTruthy()
    await user.click(screen.getByTitle('Swap this exercise for an alternate'))
    expect(onSwap).toHaveBeenCalledWith(0)
    await user.click(screen.getByTitle('Remove this exercise from today\'s session'))
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('collapses again when the header is tapped while expanded', async () => {
    const user = userEvent.setup()
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat')) // expand
    await user.click(screen.getByText('Back Squat')) // collapse

    expect(screen.queryByText('Set 1')).toBeNull()
  })

  it('tapping an empty set slot opens the rep picker without collapsing the card', async () => {
    const user = userEvent.setup()
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 1'))

    expect(screen.getByText('Depth over ego.')).toBeTruthy() // still expanded
    expect(screen.getByRole('button', { name: '6' })).toBeTruthy() // target rep, in the picker
  })

  it('marks only the next-to-fill slot as pending once the picker is open, not the others', async () => {
    const user = userEvent.setup()
    setupDraft({ r: [6] }) // one set already logged, so two empty slots render (Set 2, Set 3, Set 4)
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 2')) // the next-to-fill slot

    const set2 = screen.getByText('Set 2').closest('button')!
    const set3 = screen.getByText('Set 3').closest('button')!
    expect(/_pending_/.test(set2.className)).toBe(true)
    expect(/_pending_/.test(set3.className)).toBe(false)
  })

  it('logging a set updates the store and keeps the card open for the next set', async () => {
    const user = userEvent.setup()
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 1'))
    await user.click(screen.getByRole('button', { name: '6' }))

    expect(useSessionStore.getState().draftEx![0].r).toEqual([6])
    expect(screen.getByText('Depth over ego.')).toBeTruthy() // still expanded, not full
  })

  it('auto-collapses back to the accordion once the exercise is fully logged', async () => {
    const user = userEvent.setup()
    setupDraft({ r: [6, 6, 6] }) // one set short of def.s = 4
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 4'))
    await user.click(screen.getByRole('button', { name: '6' }))

    expect(useSessionStore.getState().draftEx![0].r).toEqual([6, 6, 6, 6])
    expect(screen.queryByText('Depth over ego.')).toBeNull() // collapsed
  })

  it('attaches the selected effort pill to the logged set', async () => {
    const user = userEvent.setup()
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 1'))
    await user.click(screen.getByRole('button', { name: 'Hard' }))
    await user.click(screen.getByRole('button', { name: '6' }))

    expect(useSessionStore.getState().draftEx![0].ef).toEqual(['h'])
  })

  it('the custom rep entry field is hidden until its toggle is tapped', async () => {
    const user = userEvent.setup()
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 1'))

    expect(screen.queryByPlaceholderText('Reps')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Enter a custom rep count' }))
    expect(screen.getByPlaceholderText('Reps')).toBeTruthy()
  })

  it('logs a custom rep count outside the preset range via the keyboard field', async () => {
    const user = userEvent.setup()
    setupDraft()
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    await user.click(screen.getByText('Back Squat'))
    await user.click(screen.getByText('Set 1'))
    await user.click(screen.getByRole('button', { name: 'Enter a custom rep count' }))
    await user.type(screen.getByPlaceholderText('Reps'), '25') // well outside target(6) ± 4
    await user.click(screen.getByRole('button', { name: 'Log custom rep count' }))

    expect(useSessionStore.getState().draftEx![0].r).toEqual([25])
  })

  it('shows one progress pip per target set, with logged ones marked done', () => {
    setupDraft({ r: [6, 6] })
    render(<ExerciseLogger def={SQ_DEF} index={0} />)

    const row = screen.getByText('Back Squat').closest('button')!
    // CSS Modules hash class names in this test env (e.g. "_pip_106a18"),
    // so match on the module-generated "_pip_"/"_pipDone_" substrings
    // rather than exact class names.
    const pips = Array.from(row.querySelectorAll('span')).filter((el) => /_pip_/.test(el.className))
    expect(pips.length).toBe(SQ_DEF.s)
    const done = pips.filter((el) => /_pipDone_/.test(el.className))
    expect(done.length).toBe(2)
  })
})

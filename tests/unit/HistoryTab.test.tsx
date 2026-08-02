import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryTab } from '@/components/tabs/HistoryTab'
import { useSessionStore } from '@/store/sessionStore'
import { useUIStore } from '@/store/uiStore'
import type { Session } from '@/types'

const REST_SESSION: Session = {
  d: '2026-07-25',
  s: 'REST_5',
  g: 'Full Rest',
  type: 'REST',
  items: [
    { n: 'Rest', d: 'all day', done: true },
    { n: 'Optional mobility', d: '10 min', done: false },
  ],
}

describe('HistoryTab — REST-type sessions', () => {
  beforeEach(() => {
    useUIStore.setState({ expandedHistoryRow: null })
  })

  // Caught live: REST sessions (Skating, Easy Run + Core, Full Rest) aren't
  // in `program` at all, so falling back to `s.s` rendered the raw internal
  // code ("REST_5") as the row title instead of the real name, which lives
  // on `g` (set by sessionStore's startRestSession), not the `t` field the
  // Session type suggests.
  it('shows the real rest-day title instead of the raw session code', () => {
    useSessionStore.setState({ sessions: [REST_SESSION] })
    render(<HistoryTab />)

    expect(screen.getByText('Full Rest')).toBeTruthy()
    expect(screen.queryByText('REST_5')).toBeNull()
  })

  it('shows a done/total item count instead of a nonsensical "0 sets"', () => {
    useSessionStore.setState({ sessions: [REST_SESSION] })
    render(<HistoryTab />)

    expect(screen.getByText(/1\/2 done/)).toBeTruthy()
    expect(screen.queryByText(/set/)).toBeNull()
  })

  it('expands to show the logged items, not an empty exercise list', async () => {
    const user = userEvent.setup()
    useSessionStore.setState({ sessions: [REST_SESSION] })
    render(<HistoryTab />)

    await user.click(screen.getByText('Full Rest'))

    expect(screen.getByText('✓ Rest')).toBeTruthy()
    expect(screen.getByText('Optional mobility')).toBeTruthy()
    expect(screen.getByText('10 min')).toBeTruthy()
  })
})

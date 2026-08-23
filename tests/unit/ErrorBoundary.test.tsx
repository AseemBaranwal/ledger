import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom')
  return <div>Rendered fine</div>
}

describe('ErrorBoundary', () => {
  // React logs caught errors to console.error by default (its own dev
  // warning, separate from this component's own componentDidCatch log) —
  // silence it so the test output isn't noisy with an expected error.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary fallback={(error) => <div>Fallback: {error.message}</div>}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Rendered fine')).toBeTruthy()
  })

  it('renders the fallback with the real error when a child throws during render', () => {
    render(
      <ErrorBoundary fallback={(error) => <div>Fallback: {error.message}</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Fallback: boom')).toBeTruthy()
    expect(screen.queryByText('Rendered fine')).toBeNull()
  })

  it('lets the fallback recover via reset() without a full page reload', async () => {
    const user = userEvent.setup()
    // A stateful parent so clicking "retry" can flip the thrown condition —
    // reset() alone just clears the boundary's own error state; whether
    // the retry actually succeeds depends on whatever caused it now being
    // fixed, same as CoachTab's real "Try again" button relies on.
    function Harness() {
      const [broken, setBroken] = useState(true)
      return (
        <ErrorBoundary
          fallback={(_error, reset) => (
            <button
              onClick={() => {
                setBroken(false)
                reset()
              }}
            >
              Try again
            </button>
          )}
        >
          <Bomb shouldThrow={broken} />
        </ErrorBoundary>
      )
    }

    render(<Harness />)
    expect(screen.getByText('Try again')).toBeTruthy()

    await user.click(screen.getByText('Try again'))

    expect(screen.getByText('Rendered fine')).toBeTruthy()
  })
})

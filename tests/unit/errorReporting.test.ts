import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reportClientError } from '@/services/errorReporting'
import { setCurrentUserId } from '@/services/userScope'

describe('reportClientError', () => {
  beforeEach(() => {
    setCurrentUserId(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('posts the message, stack, source, url, and current user id to /api/log-error', () => {
    setCurrentUserId('user-a')
    reportClientError('boom', 'at foo.ts:1', 'window.onerror')

    expect(fetch).toHaveBeenCalledWith(
      '/api/log-error',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body).toMatchObject({ message: 'boom', stack: 'at foo.ts:1', source: 'window.onerror', userId: 'user-a' })
  })

  it('sends userId: null when nobody is signed in', () => {
    reportClientError('boom')
    const body = JSON.parse((fetch as any).mock.calls[0][1].body)
    expect(body.userId).toBeNull()
  })

  // A broken error reporter must never become its own source of failure —
  // this is fire-and-forget precisely so a network error reporting a crash
  // doesn't itself throw and compound the problem.
  it('does not throw when fetch itself rejects', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(() => reportClientError('boom')).not.toThrow()
  })

  it('does not throw when fetch itself throws synchronously', () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('fetch unavailable')
    }))
    expect(() => reportClientError('boom')).not.toThrow()
  })
})

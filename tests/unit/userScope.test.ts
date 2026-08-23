import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setCurrentUserId,
  getCurrentUserId,
  scopedStorage,
  getLastKnownUserId,
  setLastKnownUserId,
  onStorageError,
} from '@/services/userScope'

describe('userScope', () => {
  beforeEach(() => {
    localStorage.clear()
    setCurrentUserId(null)
  })

  describe('scopedStorage', () => {
    it('namespaces reads/writes by the current user id', () => {
      setCurrentUserId('user-a')
      scopedStorage.setItem('ledger.sessions', 'a-data')
      setCurrentUserId('user-b')
      scopedStorage.setItem('ledger.sessions', 'b-data')

      setCurrentUserId('user-a')
      expect(scopedStorage.getItem('ledger.sessions')).toBe('a-data')
      setCurrentUserId('user-b')
      expect(scopedStorage.getItem('ledger.sessions')).toBe('b-data')
    })

    it('falls back to an "anon" key when no user id is set', () => {
      scopedStorage.setItem('ledger.sessions', 'anon-data')
      expect(localStorage.getItem('ledger.sessions.anon')).toBe('anon-data')
    })

    it('removeItem clears only the current user\'s key', () => {
      setCurrentUserId('user-a')
      scopedStorage.setItem('ledger.sessions', 'a-data')
      scopedStorage.removeItem('ledger.sessions')
      expect(scopedStorage.getItem('ledger.sessions')).toBeNull()
    })

    // Issue #58: none of these calls used to be wrapped at all — a
    // QuotaExceededError or Safari Private Browsing (which throws
    // synchronously on every setItem) propagated straight up through
    // zustand's persist middleware into whatever store action triggered
    // it, uncaught.
    it('does not throw when the underlying localStorage.setItem throws, and reports it once via onStorageError', () => {
      // jsdom's `localStorage` doesn't route through Storage.prototype —
      // spying there doesn't intercept real calls; the global instance
      // itself is what needs mocking.
      const failing = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      const listener = vi.fn()
      onStorageError(listener)

      expect(() => scopedStorage.setItem('ledger.sessions', 'x')).not.toThrow()
      expect(() => scopedStorage.setItem('ledger.sessions', 'y')).not.toThrow()
      // Fires once, not once per failed write — a device with storage
      // genuinely exhausted fails on basically every subsequent write.
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0]).toBeInstanceOf(Error)

      failing.mockRestore()
    })

    it('getItem returns null (not a throw) when localStorage.getItem itself throws', () => {
      const failing = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })

      expect(() => scopedStorage.getItem('ledger.sessions')).not.toThrow()
      expect(scopedStorage.getItem('ledger.sessions')).toBeNull()

      failing.mockRestore()
    })
  })

  describe('getLastKnownUserId / setLastKnownUserId', () => {
    it('round-trips a value across calls (survives what a page reload would reset)', () => {
      expect(getLastKnownUserId()).toBeNull()
      setLastKnownUserId('user-a')
      expect(getLastKnownUserId()).toBe('user-a')
    })

    it('is stored unscoped — unaffected by setCurrentUserId', () => {
      setLastKnownUserId('user-a')
      setCurrentUserId('user-b')
      expect(getLastKnownUserId()).toBe('user-a')
    })
  })

  it('getCurrentUserId reflects the most recent setCurrentUserId call', () => {
    setCurrentUserId('user-a')
    expect(getCurrentUserId()).toBe('user-a')
    setCurrentUserId(null)
    expect(getCurrentUserId()).toBeNull()
  })
})

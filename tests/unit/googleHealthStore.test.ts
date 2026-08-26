import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGoogleHealthStore } from '@/store/googleHealthStore'
import * as googleHealthService from '@/services/googleHealth'

// Mocked at the service-function boundary (never fetch/Supabase directly),
// but `getGoogleHealthAuthorizeUrl` is deliberately left as the REAL
// implementation — the authorize URL's exact shape is the thing most worth
// pinning down here. Drop `access_type=offline` or `prompt=consent` and
// Google silently returns no refresh token, which the backend rejects; a
// mocked-out builder would happily let that regress unnoticed.
vi.mock('@/services/googleHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/googleHealth')>()
  return {
    ...actual,
    getGoogleHealthConnection: vi.fn(),
    disconnectGoogleHealth: vi.fn(),
    exchangeGoogleHealthCode: vi.fn(),
  }
})

const realLocation = window.location

function stubLocation() {
  const fake = { origin: 'https://aseem-ledger.vercel.app', href: '' }
  Object.defineProperty(window, 'location', { value: fake, writable: true, configurable: true })
  return fake
}

describe('googleHealthStore', () => {
  beforeEach(() => {
    useGoogleHealthStore.setState({
      connected: false,
      needsReconnect: false,
      connectedAt: null,
      checking: false,
      disconnecting: false,
    })
    vi.clearAllMocks()
    vi.stubEnv('VITE_GOOGLE_HEALTH_CLIENT_ID', 'test-client-id.apps.googleusercontent.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true })
  })

  describe('connect', () => {
    it('navigates to a Google authorize URL carrying access_type=offline, prompt=consent and both health scopes', () => {
      const location = stubLocation()

      useGoogleHealthStore.getState().connect()

      expect(location.href).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
      const params = new URL(location.href).searchParams
      expect(params.get('client_id')).toBe('test-client-id.apps.googleusercontent.com')
      expect(params.get('response_type')).toBe('code')
      // Without these two, Google withholds the refresh token entirely.
      expect(params.get('access_type')).toBe('offline')
      expect(params.get('prompt')).toBe('consent')
      expect(params.get('scope')?.split(' ')).toEqual([
        'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
        'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
      ])
    })

    it('redirects to a dedicated callback path, never the app root — Supabase sign-in already owns `?code=` there', () => {
      const location = stubLocation()

      useGoogleHealthStore.getState().connect()

      const redirectUri = new URL(location.href).searchParams.get('redirect_uri')
      expect(redirectUri).toBe('https://aseem-ledger.vercel.app/google-health-callback')
      expect(redirectUri).not.toBe('https://aseem-ledger.vercel.app/')
    })

    it('does nothing when no client id is configured, rather than sending the browser somewhere broken', () => {
      vi.stubEnv('VITE_GOOGLE_HEALTH_CLIENT_ID', '')
      const location = stubLocation()

      useGoogleHealthStore.getState().connect()

      expect(location.href).toBe('')
    })
  })

  describe('checkConnection — the three UI states', () => {
    it('is not connected when no row exists', async () => {
      vi.mocked(googleHealthService.getGoogleHealthConnection).mockResolvedValue(null)

      await useGoogleHealthStore.getState().checkConnection('user-1')

      const { connected, needsReconnect, connectedAt, checking } = useGoogleHealthStore.getState()
      expect(connected).toBe(false)
      expect(needsReconnect).toBe(false)
      expect(connectedAt).toBeNull()
      expect(checking).toBe(false)
    })

    it('is connected and healthy when refresh_failed_at is null', async () => {
      vi.mocked(googleHealthService.getGoogleHealthConnection).mockResolvedValue({
        connectedAt: '2026-08-20T10:00:00Z',
        expiresAt: '2026-08-23T11:00:00Z',
        scopes: ['https://www.googleapis.com/auth/googlehealth.sleep.readonly'],
        refreshFailedAt: null,
      })

      await useGoogleHealthStore.getState().checkConnection('user-1')

      expect(useGoogleHealthStore.getState()).toMatchObject({
        connected: true,
        needsReconnect: false,
        connectedAt: '2026-08-20T10:00:00Z',
      })
    })

    // Google force-expires the refresh token every 7 days while the consent
    // screen is in "Testing" — the row stays, so this reads as connected AND
    // needing a reconnect, which is what drives the third card state.
    it('stays connected but flags needsReconnect when refresh_failed_at is set', async () => {
      vi.mocked(googleHealthService.getGoogleHealthConnection).mockResolvedValue({
        connectedAt: '2026-08-13T10:00:00Z',
        expiresAt: '2026-08-13T11:00:00Z',
        scopes: null,
        refreshFailedAt: '2026-08-20T09:12:00Z',
      })

      await useGoogleHealthStore.getState().checkConnection('user-1')

      expect(useGoogleHealthStore.getState()).toMatchObject({ connected: true, needsReconnect: true })
    })
  })

  describe('applyCallback', () => {
    it('clears a standing needsReconnect, so a just-renewed connection stops showing the reconnect prompt', () => {
      useGoogleHealthStore.setState({ connected: true, needsReconnect: true })

      useGoogleHealthStore.getState().applyCallback()

      expect(useGoogleHealthStore.getState()).toMatchObject({ connected: true, needsReconnect: false })
    })
  })

  describe('disconnect', () => {
    it('clears every connection field and drops the disconnecting flag on success', async () => {
      vi.mocked(googleHealthService.disconnectGoogleHealth).mockResolvedValue(undefined)
      useGoogleHealthStore.setState({ connected: true, needsReconnect: true, connectedAt: '2026-08-13T10:00:00Z' })

      await useGoogleHealthStore.getState().disconnect()

      expect(useGoogleHealthStore.getState()).toMatchObject({
        connected: false,
        needsReconnect: false,
        connectedAt: null,
        disconnecting: false,
      })
    })

    it('rethrows on failure, keeps showing the connection, and still clears the disconnecting flag', async () => {
      vi.mocked(googleHealthService.disconnectGoogleHealth).mockRejectedValue(new Error('Could not disconnect Google Health'))
      useGoogleHealthStore.setState({ connected: true, connectedAt: '2026-08-13T10:00:00Z' })

      await expect(useGoogleHealthStore.getState().disconnect()).rejects.toThrow('Could not disconnect Google Health')

      // The row is still there server-side, so the UI must not pretend the
      // connection is gone — SyncTab surfaces the throw as a toast instead.
      expect(useGoogleHealthStore.getState()).toMatchObject({ connected: true, disconnecting: false })
    })
  })

  describe('reset', () => {
    it('clears connection state (used on sign-out)', () => {
      useGoogleHealthStore.setState({ connected: true, needsReconnect: true, connectedAt: '2026-08-13T10:00:00Z' })

      useGoogleHealthStore.getState().reset()

      expect(useGoogleHealthStore.getState()).toMatchObject({
        connected: false,
        needsReconnect: false,
        connectedAt: null,
      })
    })
  })
})

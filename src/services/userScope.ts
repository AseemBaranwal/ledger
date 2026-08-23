// The local Zustand `persist` caches (sessions, body scans) need to be
// isolated per signed-in user — otherwise if two people ever use the same
// browser, the second person would see the first person's cached workouts
// until a sync happened to overwrite them. Since zustand's persist middleware
// only reads its storage key once at store-creation time (before auth has
// resolved), the actual user id isn't known yet — so instead of baking it
// into the key up front, the storage adapter below reads whatever the
// current user id is at the moment of each read/write, and authStore calls
// `.persist.rehydrate()` on the affected stores right after sign-in/out to
// force them to re-read using the now-correct scoped key.
let currentUserId: string | null = null

export function setCurrentUserId(id: string | null) {
  currentUserId = id
}

export function getCurrentUserId(): string | null {
  return currentUserId
}

function scopedKey(name: string): string {
  return `${name}.${currentUserId || 'anon'}`
}

// Services in this codebase don't depend on stores (App.tsx is the layer
// that wires this callback to an actual useUIStore notification) — a
// plain listener keeps this module able to stay a pure, storeless service.
type StorageErrorListener = (error: Error) => void
let storageErrorListener: StorageErrorListener | null = null
// A device with storage genuinely exhausted (QuotaExceededError) or in a
// mode that blocks it entirely (Safari Private Browsing throws on every
// setItem) fails on basically every write from then on — without this,
// the listener would fire on every single set/rep logged instead of once.
let hasNotifiedStorageError = false

export function onStorageError(listener: StorageErrorListener) {
  storageErrorListener = listener
}

// Every localStorage call in this module goes through this — a
// QuotaExceededError or Safari Private Browsing's synchronous throw on
// setItem would otherwise propagate straight up through zustand's persist
// middleware into whatever store action triggered it (logRep, saveDraft,
// ...), uncaught. Caught here and surfaced once via the listener above;
// the write becomes a no-op instead — data just doesn't persist for that
// action, a real limitation but survivable, unlike a crash.
function safeStorageCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (e) {
    if (!hasNotifiedStorageError) {
      hasNotifiedStorageError = true
      storageErrorListener?.(e instanceof Error ? e : new Error(String(e)))
    }
    return fallback
  }
}

export const scopedStorage = {
  getItem: (name: string) => safeStorageCall(() => localStorage.getItem(scopedKey(name)), null),
  setItem: (name: string, value: string) => safeStorageCall(() => localStorage.setItem(scopedKey(name), value), undefined),
  removeItem: (name: string) => safeStorageCall(() => localStorage.removeItem(scopedKey(name)), undefined),
}

// Deliberately a PLAIN (unscoped) localStorage key, not one of the
// per-user ones above — it has to survive a page reload on its own before
// any user id is known yet, which is exactly what it's for: distinguishing
// "the same user reopening the app" (in-memory auth state always starts
// null on a fresh load, so comparing against that alone can't tell this
// apart from a genuine account switch) from an actual different-user
// switch. See authStore.ts's isAccountSwitch, which uses this to decide
// whether to blank local state before rehydrating — only a genuine switch
// should, since blanking writes through to storage synchronously and would
// otherwise race ahead of (and clobber) the read rehydrate() is about to do.
const LAST_USER_KEY = 'ledger.lastUserId'

export function getLastKnownUserId(): string | null {
  return safeStorageCall(() => localStorage.getItem(LAST_USER_KEY), null)
}

export function setLastKnownUserId(id: string): void {
  // A failed write here just means the next cold start can't tell itself
  // apart from a genuine account switch and falls back to the old
  // always-blank behavior — safe (no cross-user leak), just not the fix.
  safeStorageCall(() => localStorage.setItem(LAST_USER_KEY, id), undefined)
}

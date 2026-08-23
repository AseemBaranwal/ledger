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

export const scopedStorage = {
  getItem: (name: string) => localStorage.getItem(scopedKey(name)),
  setItem: (name: string, value: string) => localStorage.setItem(scopedKey(name), value),
  removeItem: (name: string) => localStorage.removeItem(scopedKey(name)),
}

// Deliberately a PLAIN (unscoped) localStorage key, not one of the
// per-user ones above — it has to survive a page reload on its own before
// any user id is known yet, which is exactly what it's for: distinguishing
// "the same user reopening the app" (in-memory auth state always starts
// null on a fresh load, so comparing against that alone can't tell this
// apart from a genuine account switch) from an actual different-user
// switch. See authStore.ts's isAccountSwitch — this is what fixes the
// cold-start draft-wipe bug (issue #58): only a genuine switch should
// blank local state before rehydrating; the same user's own reload
// shouldn't, since that blank writes through to storage synchronously and
// was racing ahead of (and clobbering) the read rehydrate() was about to do.
const LAST_USER_KEY = 'ledger.lastUserId'

export function getLastKnownUserId(): string | null {
  return localStorage.getItem(LAST_USER_KEY)
}

export function setLastKnownUserId(id: string): void {
  localStorage.setItem(LAST_USER_KEY, id)
}

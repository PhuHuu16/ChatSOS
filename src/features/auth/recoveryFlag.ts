// Which account is in the middle of a password recovery: signed in by a recovery code or
// link, new password not saved yet. Kept in localStorage so a reload or another tab still
// shows the new password form instead of the app, and so finishing in one tab ends it in
// the others. Navigation only, not a security boundary: the recovery session is a full
// session either way.
//
// Holds the user id only. When storage cannot be used (private mode, blocked, full), the
// flag lives in this page's memory and is lost on reload; the user is then simply signed in.
const KEY = 'chatsos:recovery'

// Only used while storage fails, so a flag cleared by another tab is never shadowed here.
let fallback: string | null = null

export function readRecoveryUserId(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? fallback
  } catch {
    return fallback
  }
}

export function markRecovery(userId: string): void {
  try {
    window.localStorage.setItem(KEY, userId)
    fallback = null
  } catch {
    fallback = userId
  }
}

export function clearRecovery(): void {
  fallback = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing stored.
  }
}

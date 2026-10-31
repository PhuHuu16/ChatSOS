import type { AuthStatus } from '../features/auth/authContext'
import { PATHS, type AppPath } from './navigation'

// Where the current auth state requires the app to be, or null to stay on this path.
// Every target is a path its own status accepts, so redirects cannot loop.
export function getAuthRedirect(status: AuthStatus, pathname: string): AppPath | null {
  // The stored session is still being restored: any redirect now could be wrong.
  if (status === 'loading') return null
  if (status === 'signedOut') {
    return pathname === PATHS.login || pathname === PATHS.register || pathname === PATHS.forgotPassword
      ? null
      : PATHS.login
  }
  // Signed in by a recovery code or link: only the new password form, until it is saved
  // or the recovery is cancelled. Navigation only, not a security boundary: the recovery
  // session is a full session.
  if (status === 'recovering') {
    return pathname === PATHS.forgotPassword ? null : PATHS.forgotPassword
  }
  return pathname === PATHS.chat ? null : PATHS.chat
}

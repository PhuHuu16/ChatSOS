import type { AuthStatus } from '../features/auth/authContext'
import { PATHS, type AppPath } from './navigation'

// Chuyển hướng theo đăng nhập
export function getAuthRedirect(status: AuthStatus, pathname: string): AppPath | null {
  if (status === 'loading') return null
  if (status === 'signedOut') {
    return pathname === PATHS.login || pathname === PATHS.register || pathname === PATHS.forgotPassword
      ? null
      : PATHS.login
  }
  if (status === 'recovering') {
    return pathname === PATHS.forgotPassword ? null : PATHS.forgotPassword
  }
  return pathname === PATHS.chat ? null : PATHS.chat
}

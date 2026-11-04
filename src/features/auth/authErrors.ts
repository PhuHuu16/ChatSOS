import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'
import type { AuthErrorKey } from './authContext'

export type AuthAction = 'signIn' | 'signUp' | 'verifyRecovery' | 'updatePassword'

const KEY_BY_CODE: Partial<Record<string, AuthErrorKey>> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  email_not_confirmed: 'auth.errors.emailNotConfirmed',
  user_already_exists: 'auth.errors.emailAlreadyRegistered',
  email_exists: 'auth.errors.emailAlreadyRegistered',
  weak_password: 'auth.errors.weakPassword',
  email_address_invalid: 'auth.errors.emailInvalid',
  signup_disabled: 'auth.errors.signupDisabled',
  over_request_rate_limit: 'auth.errors.rateLimited',
  over_email_send_rate_limit: 'auth.errors.rateLimited',
}

const KEY_BY_HOOK_MESSAGE: Partial<Record<string, AuthErrorKey>> = {
  'chatsos:username_invalid': 'auth.errors.usernameInvalid',
  'chatsos:phone_invalid': 'auth.errors.phoneInvalid',
  'chatsos:username_taken': 'auth.errors.usernameTaken',
  'chatsos:phone_taken': 'auth.errors.phoneTaken',
}

const KEY_BY_FUNCTION_CODE: Partial<Record<string, AuthErrorKey>> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  email_not_confirmed: 'auth.errors.emailNotConfirmed',
  rate_limited: 'auth.errors.phoneRateLimited',
  unavailable: 'auth.errors.phoneUnavailable',
}

export function phoneSignInErrorKey(status: number, code: unknown): AuthErrorKey {
  const byCode = typeof code === 'string' ? KEY_BY_FUNCTION_CODE[code] : undefined
  if (byCode) return byCode
  if (status === 429) return 'auth.errors.phoneRateLimited'
  if (status >= 500) return 'auth.errors.phoneUnavailable'
  return 'auth.errors.unexpected'
}

export function resetRequestErrorKey(error: unknown): AuthErrorKey | null {
  if (isAuthRetryableFetchError(error) && error.status === 0) return 'auth.errors.network'
  if (isAuthError(error) && error.code === 'over_request_rate_limit') return 'auth.errors.rateLimited'
  return null
}

export function toAuthErrorKey(error: unknown, action: AuthAction): AuthErrorKey {
  if (isAuthRetryableFetchError(error) && error.status === 0) return 'auth.errors.network'
  if (isAuthWeakPasswordError(error)) return 'auth.errors.weakPassword'
  if (!isAuthError(error)) return 'auth.errors.unexpected'

  if (action === 'signUp') {
    const byHook = KEY_BY_HOOK_MESSAGE[error.message]
    if (byHook) return byHook
  }

  if (action === 'verifyRecovery' && error.code === 'otp_expired') {
    return 'auth.errors.recoveryCodeInvalid'
  }
  if (action === 'updatePassword') {
    if (error.code === 'same_password') return 'auth.errors.samePassword'
    if (error.status === 401 || error.status === 403 || error.code === 'session_not_found') {
      return 'auth.errors.recoveryExpired'
    }
  }

  const byCode = error.code ? KEY_BY_CODE[error.code] : undefined
  if (byCode) return byCode

  if (action === 'signUp' && error.status === 500) return 'auth.errors.signupFailed'
  return 'auth.errors.unexpected'
}

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'
import type { AuthErrorKey } from './authContext'

export type AuthAction = 'signIn' | 'signUp'

// Only error.code values that identify the case exactly. The error message text is never
// matched or shown: it is not a stable contract and may differ between server versions.
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

export function toAuthErrorKey(error: unknown, action: AuthAction): AuthErrorKey {
  // auth-js reports "no HTTP response" (network failure, aborted request) as status 0.
  if (isAuthRetryableFetchError(error) && error.status === 0) return 'auth.errors.network'
  if (isAuthWeakPasswordError(error)) return 'auth.errors.weakPassword'
  if (!isAuthError(error)) return 'auth.errors.unexpected'

  const byCode = error.code ? KEY_BY_CODE[error.code] : undefined
  if (byCode) return byCode

  // Any exception in the signup transaction, including the handle_new_user trigger, comes
  // back as HTTP 500 without the cause, so the message must not claim a specific reason.
  if (action === 'signUp' && error.status === 500) return 'auth.errors.signupFailed'
  return 'auth.errors.unexpected'
}

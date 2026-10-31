import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'
import type { AuthErrorKey } from './authContext'

export type AuthAction = 'signIn' | 'signUp' | 'verifyRecovery' | 'updatePassword'

// Only error.code values that identify the case exactly. Supabase's own message text is
// never matched or shown: it is not a stable contract and may differ between server versions.
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

// Messages returned by public.hook_before_user_created (migration 10). They are ChatSOS's
// own contract, not Supabase's, so matching them exactly is safe.
const KEY_BY_HOOK_MESSAGE: Partial<Record<string, AuthErrorKey>> = {
  'chatsos:username_invalid': 'auth.errors.usernameInvalid',
  'chatsos:phone_invalid': 'auth.errors.phoneInvalid',
  'chatsos:username_taken': 'auth.errors.usernameTaken',
  'chatsos:phone_taken': 'auth.errors.phoneTaken',
}

// Codes of the phone-sign-in Edge Function (supabase/functions/phone-sign-in/handler.ts).
// rate_limited is the same answer for registered and unregistered numbers, so its message
// says nothing about whether the number has an account.
const KEY_BY_FUNCTION_CODE: Partial<Record<string, AuthErrorKey>> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  email_not_confirmed: 'auth.errors.emailNotConfirmed',
  rate_limited: 'auth.errors.phoneRateLimited',
  unavailable: 'auth.errors.phoneUnavailable',
}

// An error answer of the phone-sign-in Edge Function. Answers without a known code come
// from the Supabase gateway (function not deployed, not started, over its limits).
export function phoneSignInErrorKey(status: number, code: unknown): AuthErrorKey {
  const byCode = typeof code === 'string' ? KEY_BY_FUNCTION_CODE[code] : undefined
  if (byCode) return byCode
  if (status === 429) return 'auth.errors.phoneRateLimited'
  if (status >= 500) return 'auth.errors.phoneUnavailable'
  return 'auth.errors.unexpected'
}

// Requesting a recovery code: the answer must not tell whether the address has an account.
// Auth fails only for registered addresses when it cannot send (over_email_send_rate_limit,
// email_address_not_authorized, an SMTP error), so every such failure is shown exactly like
// a success. Only failures that do not depend on the address are reported: no connection,
// and the per-IP request limit. null: show the neutral "if registered, a code was sent".
export function resetRequestErrorKey(error: unknown): AuthErrorKey | null {
  if (isAuthRetryableFetchError(error) && error.status === 0) return 'auth.errors.network'
  if (isAuthError(error) && error.code === 'over_request_rate_limit') return 'auth.errors.rateLimited'
  return null
}

export function toAuthErrorKey(error: unknown, action: AuthAction): AuthErrorKey {
  // auth-js reports "no HTTP response" (network failure, aborted request) as status 0.
  if (isAuthRetryableFetchError(error) && error.status === 0) return 'auth.errors.network'
  if (isAuthWeakPasswordError(error)) return 'auth.errors.weakPassword'
  if (!isAuthError(error)) return 'auth.errors.unexpected'

  if (action === 'signUp') {
    const byHook = KEY_BY_HOOK_MESSAGE[error.message]
    if (byHook) return byHook
  }

  // Auth answers otp_expired for a wrong code too, and for an address without an account.
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

  // Any exception in the signup transaction, including the handle_new_user trigger, comes
  // back as HTTP 500 without the cause, so the message must not claim a specific reason.
  // With the Before User Created hook enabled, taken or invalid usernames and phone
  // numbers are reported above instead.
  if (action === 'signUp' && error.status === 500) return 'auth.errors.signupFailed'
  return 'auth.errors.unexpected'
}

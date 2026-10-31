import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Translation } from '../../i18n/locales/vi'
import type { SignInIdentifier } from './validation'

// 'loading' until Supabase has restored any stored session; never redirect while loading.
// 'recovering': signed in by a password recovery code or link, and the new password is not
// saved yet; the app stays on the forgot password page until it is (or is cancelled).
export type AuthStatus = 'loading' | 'signedIn' | 'signedOut' | 'recovering'

type AuthErrorName = keyof Translation['auth']['errors']
export type AuthErrorKey = `auth.errors.${AuthErrorName}`

export type AuthActionResult = { ok: true } | { ok: false; error: AuthErrorKey }
export type SignInResult = AuthActionResult

// needsEmailConfirmation: the account exists but has no session until the email is confirmed.
export type SignUpResult =
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; error: AuthErrorKey }

// ok: false does not say whether the session is gone; the auth status reports that.
export type SignOutResult = { ok: boolean }

// Values must already be validated and trimmed (see validation.ts); passwords are not trimmed.
export interface SignUpInput {
  email: string
  password: string
  username: string
  displayName: string
  // Already in the stored form (+84xxxxxxxxx), see normalizePhone.
  phone: string
}

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  signIn: (identifier: SignInIdentifier, password: string) => Promise<SignInResult>
  signUp: (input: SignUpInput) => Promise<SignUpResult>
  signOut: () => Promise<SignOutResult>
  // ok: true does not mean an email was sent: the answer is the same whether or not the
  // address has an account (see resetRequestErrorKey).
  requestPasswordReset: (email: string) => Promise<AuthActionResult>
  // On success the status becomes 'recovering'.
  verifyRecoveryCode: (email: string, code: string) => Promise<AuthActionResult>
  // Only while 'recovering'. On success the status becomes 'signedIn' and the account's
  // other sessions are signed out.
  updatePassword: (password: string) => Promise<AuthActionResult>
  // Signs this device out, which ends the recovery.
  cancelRecovery: () => Promise<SignOutResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

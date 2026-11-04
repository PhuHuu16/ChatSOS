import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Translation } from '../../i18n/locales/vi'
import type { SignInIdentifier } from './validation'

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut' | 'recovering'

type AuthErrorName = keyof Translation['auth']['errors']
export type AuthErrorKey = `auth.errors.${AuthErrorName}`

export type AuthActionResult = { ok: true } | { ok: false; error: AuthErrorKey }
export type SignInResult = AuthActionResult

export type SignUpResult =
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; error: AuthErrorKey }

export type SignOutResult = { ok: boolean }

export interface SignUpInput {
  email: string
  password: string
  username: string
  displayName: string
  phone: string
}

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  signIn: (identifier: SignInIdentifier, password: string) => Promise<SignInResult>
  signUp: (input: SignUpInput) => Promise<SignUpResult>
  signOut: () => Promise<SignOutResult>
  requestPasswordReset: (email: string) => Promise<AuthActionResult>
  verifyRecoveryCode: (email: string, code: string) => Promise<AuthActionResult>
  updatePassword: (password: string) => Promise<AuthActionResult>
  cancelRecovery: () => Promise<SignOutResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

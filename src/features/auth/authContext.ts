import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Translation } from '../../i18n/locales/vi'

// 'loading' until Supabase has restored any stored session; never redirect while loading.
export type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

type AuthErrorName = keyof Translation['auth']['errors']
export type AuthErrorKey = `auth.errors.${AuthErrorName}`

export type SignInResult = { ok: true } | { ok: false; error: AuthErrorKey }

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
}

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  signIn: (email: string, password: string) => Promise<SignInResult>
  signUp: (input: SignUpInput) => Promise<SignUpResult>
  signOut: () => Promise<SignOutResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

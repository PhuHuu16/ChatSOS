import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import {
  AuthContext,
  type AuthActionResult,
  type AuthContextValue,
  type AuthStatus,
  type SignInResult,
  type SignOutResult,
  type SignUpInput,
  type SignUpResult,
} from './authContext'
import { resetRequestErrorKey, toAuthErrorKey } from './authErrors'
import { signInWithPhone } from './phoneSignIn'
import { clearRecovery, markRecovery, readRecoveryUserId } from './recoveryFlag'
import type { SignInIdentifier } from './validation'

// These never update state themselves: the onAuthStateChange listener below is the single
// source of truth for the session. The one exception is updatePassword (in the provider),
// which ends a recovery without any auth event to report it. Nothing here logs passwords,
// codes, tokens or raw errors.

async function signIn(identifier: SignInIdentifier, password: string): Promise<SignInResult> {
  try {
    if (identifier.kind === 'phone') return await signInWithPhone(identifier.phone, password)
    const { error } = await supabase.auth.signInWithPassword({ email: identifier.email, password })
    if (error) return { ok: false, error: toAuthErrorKey(error, 'signIn') }
    return { ok: true }
  } catch {
    return { ok: false, error: 'auth.errors.unexpected' }
  }
}

async function signUp({
  email,
  password,
  username,
  displayName,
  phone,
}: SignUpInput): Promise<SignUpResult> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Read by the handle_new_user trigger, which creates the profile row, and checked
      // first by the Before User Created hook (migration 10).
      options: { data: { username, display_name: displayName, phone } },
    })
    if (error) return { ok: false, error: toAuthErrorKey(error, 'signUp') }
    if (data.session) return { ok: true, needsEmailConfirmation: false }
    if (data.user) return { ok: true, needsEmailConfirmation: true }
    return { ok: false, error: 'auth.errors.unexpected' }
  } catch {
    return { ok: false, error: 'auth.errors.unexpected' }
  }
}

async function signOut(): Promise<SignOutResult> {
  try {
    // 'local' signs out this device only. When the stored session is removed, the listener
    // receives SIGNED_OUT before this resolves. An error does not tell whether that
    // happened: auth-js (2.117) still removes the session after most server errors, but
    // keeps it when the current session cannot be read or refreshed (e.g. offline).
    // The listener reports which; callers must not treat ok: false as "still signed in".
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    return { ok: !error }
  } catch {
    return { ok: false }
  }
}

// Sends the recovery email (a code, or a link with the default template). The answer is
// the same whether or not the address has an account, see resetRequestErrorKey.
async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  let failure: unknown
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    failure = error
  } catch (error) {
    failure = error
  }
  const key = failure ? resetRequestErrorKey(failure) : null
  return key ? { ok: false, error: key } : { ok: true }
}

// On success auth-js stores the session and emits PASSWORD_RECOVERY before this resolves;
// the listener then marks the recovery.
async function verifyRecoveryCode(email: string, code: string): Promise<AuthActionResult> {
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' })
    if (error) return { ok: false, error: toAuthErrorKey(error, 'verifyRecovery') }
    return { ok: true }
  } catch {
    return { ok: false, error: 'auth.errors.unexpected' }
  }
}

// How long signing out the other sessions may delay entering the app.
const SIGN_OUT_OTHERS_TIMEOUT_MS = 5000

function statusFor(session: Session | null): AuthStatus {
  if (!session) return 'signedOut'
  return readRecoveryUserId() === session.user.id ? 'recovering' : 'signedIn'
}

interface AuthState {
  status: AuthStatus
  session: Session | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null })

  useEffect(() => {
    // Each subscription gets its own INITIAL_SESSION once the stored session is restored
    // (null if there is none or restoring failed), then SIGNED_IN / SIGNED_OUT /
    // TOKEN_REFRESHED. StrictMode mounts twice in development: the first subscription is
    // removed in cleanup, and `active` guards against a late call after that.
    // The callback only sets state; it never calls back into Supabase.
    // PASSWORD_RECOVERY: signed in by a recovery code or link (also relayed from other
    // tabs). Without a session any recovery is over.
    let active = true
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' && session) markRecovery(session.user.id)
      else if (!session) clearRecovery()
      setState({ status: statusFor(session), session })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  // Saves the new password, ends the recovery and signs the account out everywhere else:
  // someone who forgot their password may also have had it taken. Failing to sign out
  // the others does not undo the new password.
  const updatePassword = useCallback(async (password: string): Promise<AuthActionResult> => {
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return { ok: false, error: toAuthErrorKey(error, 'updatePassword') }
    } catch {
      return { ok: false, error: 'auth.errors.unexpected' }
    }
    // scope 'others' keeps this device's session and emits no SIGNED_OUT here.
    await Promise.race([
      supabase.auth.signOut({ scope: 'others' }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, SIGN_OUT_OTHERS_TIMEOUT_MS)),
    ])
    clearRecovery()
    setState((current) =>
      current.status === 'recovering' ? { ...current, status: statusFor(current.session) } : current,
    )
    return { ok: true }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      verifyRecoveryCode,
      updatePassword,
      // Signing out ends the recovery (the listener clears it on SIGNED_OUT).
      cancelRecovery: signOut,
    }),
    [state, updatePassword],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

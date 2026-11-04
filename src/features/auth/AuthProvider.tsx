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

// Đăng nhập
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

// Đăng ký
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

// Đăng xuất
async function signOut(): Promise<SignOutResult> {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    return { ok: !error }
  } catch {
    return { ok: false }
  }
}

// Gửi mã khôi phục mật khẩu
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

// Xác minh mã khôi phục
async function verifyRecoveryCode(email: string, code: string): Promise<AuthActionResult> {
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' })
    if (error) return { ok: false, error: toAuthErrorKey(error, 'verifyRecovery') }
    return { ok: true }
  } catch {
    return { ok: false, error: 'auth.errors.unexpected' }
  }
}

const SIGN_OUT_OTHERS_TIMEOUT_MS = 5000

function statusFor(session: Session | null): AuthStatus {
  if (!session) return 'signedOut'
  return readRecoveryUserId() === session.user.id ? 'recovering' : 'signedIn'
}

interface AuthState {
  status: AuthStatus
  session: Session | null
}

// Quản lý phiên đăng nhập
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null })

  useEffect(() => {
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

  const updatePassword = useCallback(async (password: string): Promise<AuthActionResult> => {
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return { ok: false, error: toAuthErrorKey(error, 'updatePassword') }
    } catch {
      return { ok: false, error: 'auth.errors.unexpected' }
    }
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
      cancelRecovery: signOut,
    }),
    [state, updatePassword],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

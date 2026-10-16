import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type SignInResult,
  type SignUpInput,
  type SignUpResult,
} from './authContext'
import { toAuthErrorKey } from './authErrors'

// These never update state themselves: the onAuthStateChange listener below is the single
// source of truth for the session. Nothing here logs passwords, tokens or raw errors.

async function signIn(email: string, password: string): Promise<SignInResult> {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, error: toAuthErrorKey(error, 'signIn') }
    return { ok: true }
  } catch {
    return { ok: false, error: 'auth.errors.unexpected' }
  }
}

async function signUp({ email, password, username, displayName }: SignUpInput): Promise<SignUpResult> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Read by the handle_new_user trigger, which creates the profile row.
      options: { data: { username, display_name: displayName } },
    })
    if (error) return { ok: false, error: toAuthErrorKey(error, 'signUp') }
    if (data.session) return { ok: true, needsEmailConfirmation: false }
    if (data.user) return { ok: true, needsEmailConfirmation: true }
    return { ok: false, error: 'auth.errors.unexpected' }
  } catch {
    return { ok: false, error: 'auth.errors.unexpected' }
  }
}

async function signOut(): Promise<void> {
  try {
    // 'local' signs out this device only. auth-js clears the local session even when the
    // server call returns an error, and the listener then reports the signed-out state.
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Not shown to the user; the listener reflects whatever session remains.
  }
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
    let active = true
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setState({ status: session ? 'signedIn' : 'signedOut', session })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signUp, signOut }),
    [state],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

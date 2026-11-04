import { supabase, supabaseKey, supabaseUrl } from '../../lib/supabase'
import type { SignInResult } from './authContext'
import { phoneSignInErrorKey, toAuthErrorKey } from './authErrors'

const FUNCTION_PATH = '/functions/v1/phone-sign-in'

interface SessionTokens {
  access_token: string
  refresh_token: string
}

function isSessionTokens(value: unknown): value is SessionTokens {
  if (typeof value !== 'object' || value === null) return false
  const { access_token, refresh_token } = value as Record<string, unknown>
  return typeof access_token === 'string' && access_token !== '' &&
    typeof refresh_token === 'string' && refresh_token !== ''
}

// Đăng nhập bằng số điện thoại
export async function signInWithPhone(phone: string, password: string): Promise<SignInResult> {
  let response: Response
  try {
    response = await fetch(new URL(FUNCTION_PATH, supabaseUrl), {
      method: 'POST',
      headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    })
  } catch {
    return { ok: false, error: 'auth.errors.network' }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Bỏ qua lỗi
  }

  if (!response.ok) {
    const code = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).code : undefined
    return { ok: false, error: phoneSignInErrorKey(response.status, code) }
  }
  if (!isSessionTokens(body)) return { ok: false, error: 'auth.errors.unexpected' }

  const { error } = await supabase.auth.setSession(body)
  if (error) return { ok: false, error: toAuthErrorKey(error, 'signIn') }
  return { ok: true }
}

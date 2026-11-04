import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { createHandler } from './handler.ts'

const CALL_TIMEOUT_MS = 5000
const MIN_ERROR_MS = 1200

function readKey(keysVar: string, legacyVar: string): string {
  const keys = Deno.env.get(keysVar)
  if (keys) {
    try {
      const key = JSON.parse(keys).default
      if (typeof key === 'string' && key) return key
    } catch {
      // Bỏ qua lỗi
    }
  }
  const legacy = Deno.env.get(legacyVar)
  if (legacy) return legacy
  throw new Error(`${keysVar} and ${legacyVar} are not set`)
}

const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch },
}

function failure(code: string | undefined, status?: number): Error {
  return Object.assign(new Error('call failed'), { code, status })
}

const url = Deno.env.get('SUPABASE_URL')
if (!url) throw new Error('SUPABASE_URL is not set')
const admin = createClient(url, readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), CLIENT_OPTIONS)
const publishableKey = readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')

const ipHeader = Deno.env.get('PHONE_SIGN_IN_IP_HEADER')?.trim().toLowerCase() || null

const handler = createHandler(
  {
    async checkLimit(phone, ip) {
      const { data, error } = await admin.rpc('phone_sign_in_check', { p_phone: phone, p_ip: ip })
      if (error) throw failure(error.code)
      if (typeof data !== 'boolean') throw failure('unexpected_result')
      return data
    },
    async recordSuccess(phone) {
      const { error } = await admin.rpc('phone_sign_in_succeeded', { p_phone: phone })
      if (error) throw failure(error.code)
    },
    async findUserId(phone) {
      const { data, error } = await admin.from('profiles').select('id').eq('phone', phone).maybeSingle()
      if (error) throw failure(error.code)
      return data ? data.id : null
    },
    async findEmail(userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId)
      if (error) throw failure(error.code, error.status)
      return data.user?.email ?? null
    },
    async signIn(email, password) {
      const client = createClient(url, publishableKey, CLIENT_OPTIONS)
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) return { ok: false, code: error.code ?? null }
      if (!data.session) throw failure('no_session')
      return { ok: true, accessToken: data.session.access_token, refreshToken: data.session.refresh_token }
    },
    log: (message) => console.error(message),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
  { ipHeader, minErrorMs: MIN_ERROR_MS, callTimeoutMs: CALL_TIMEOUT_MS },
)

Deno.serve(handler)

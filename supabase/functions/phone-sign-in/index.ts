// ChatSOS · Edge Function phone-sign-in: sign in with a phone number and password.
//
// Supabase Auth signs in by email (its own phone sign-in needs a paid SMS provider), and
// ChatSOS keeps the phone number in public.profiles, which clients cannot read. This
// function finds the account's email with the secret key and signs in with it, so the
// email never reaches the browser. The app then stores the session with setSession.
//
// Deploy with verify_jwt = false: callers are signed out, and the app sends only the
// publishable key (not a JWT) in the apikey header.
//
// POST { phone, password } → 200 { access_token, refresh_token } or 4xx/5xx { code }.
// The request handling (limit first, uniform answers, logging) is in handler.ts; this file
// only connects it to Supabase. Needs migration 11 (phone_sign_in_check).
//
// Optional secret PHONE_SIGN_IN_IP_HEADER: the request header that holds the caller's IP
// address. Leave it unset until it is verified that callers cannot forge that header;
// unset means no per-IP limit, only the per-number one.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { createHandler } from './handler.ts'

const CALL_TIMEOUT_MS = 5000
const MIN_ERROR_MS = 1200

// The "default" key from SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS, or the legacy
// anon / service_role key when the project has no new keys.
function readKey(keysVar: string, legacyVar: string): string {
  const keys = Deno.env.get(keysVar)
  if (keys) {
    try {
      const key = JSON.parse(keys).default
      if (typeof key === 'string' && key) return key
    } catch {
      // Fall back to the legacy key below.
    }
  }
  const legacy = Deno.env.get(legacyVar)
  if (legacy) return legacy
  throw new Error(`${keysVar} and ${legacyVar} are not set`)
}

// Aborts each HTTP request after CALL_TIMEOUT_MS, so a timed-out call does not keep running.
const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch },
}

// Thrown with a code only: the handler logs the code and never the message.
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
      // profiles_phone_key makes the number unique, so there is at most one row.
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
      // With the publishable key, exactly as the app would sign in with the email. A new
      // client each time, so no session stays in memory between requests.
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

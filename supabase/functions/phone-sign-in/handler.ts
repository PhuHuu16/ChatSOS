// ChatSOS · phone-sign-in request handling, without Deno or supabase-js, so it can be
// unit tested in Node (handler.test.mjs). index.ts wires it to the real services.
//
// Order of a request:
//   1. read and check the body;
//   2. record the attempt (phone_sign_in_check) BEFORE anything reveals whether the number
//      is registered, so registered and unregistered numbers count alike;
//   3. find the account, then sign in with its email;
//   4. after a success, clear the number's counter.
// The limiter fails closed: an error or a timeout answers `unavailable` and stops there.
//
// Every answer is { code } (or the two tokens on success). Every error except
// rate_limited takes at least minErrorMs, so a quick "unknown number" looks like a slow
// "wrong password". That only blurs timing; the counter is what stops guessing.
// Logs carry the failing step and an error code only: never the phone number, IP address,
// email, password or tokens.

export type SignInResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; code: string | null }

export interface SignInDeps {
  // Records one attempt and says whether it is within the limits. Throws on any failure.
  checkLimit(phone: string, ip: string | null): Promise<boolean>
  // Clears the number's counter after a successful sign-in.
  recordSuccess(phone: string): Promise<void>
  // The account id for a normalized number, or null when no account has it.
  findUserId(phone: string): Promise<string | null>
  // The account's email, or null when it has none.
  findEmail(userId: string): Promise<string | null>
  signIn(email: string, password: string): Promise<SignInResult>
  log(message: string): void
  now(): number
  sleep(ms: number): Promise<void>
}

export interface HandlerOptions {
  // Request header holding the caller's IP address, set only once it is verified that
  // callers cannot forge it. null: no IP limit, the per-number limit only.
  ipHeader: string | null
  minErrorMs: number
  callTimeoutMs: number
}

export const MAX_PHONE_LENGTH = 32
export const MAX_PASSWORD_LENGTH = 1024

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// An IPv4 or IPv6 address as one header value; anything else is refused, not trimmed.
const IP_ADDRESS = /^(?:[0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9A-Fa-f:]{2,39}(?::[0-9]{1,3}(?:\.[0-9]{1,3}){3})?)$/

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/

// Same as private.normalize_vn_phone (migration 10) and normalizePhone in
// src/features/auth/validation.ts: the stored form +84xxxxxxxxx, or null.
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/[\s.()-]/g, '')
  if (/^0[35789][0-9]{8}$/.test(digits)) return `+84${digits.slice(1)}`
  if (/^84[35789][0-9]{8}$/.test(digits)) return `+${digits}`
  if (/^\+84[35789][0-9]{8}$/.test(digits)) return digits
  return null
}

class TimeoutError extends Error {
  code = 'timeout'
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('timed out')), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

// Only a short code (PostgREST / Auth code, HTTP status or 'timeout'), never a message:
// messages can quote the values sent.
function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && SAFE_CODE.test(code)) return code
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && Number.isInteger(status)) return `status ${status}`
  }
  return 'no code'
}

function json(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export function createHandler(deps: SignInDeps, options: HandlerOptions) {
  const call = <T>(work: () => Promise<T>) => withTimeout(work(), options.callTimeoutMs)

  return async function handle(request: Request): Promise<Response> {
    const startedAt = deps.now()

    const fail = async (status: number, code: string) => {
      const wait = startedAt + options.minErrorMs - deps.now()
      if (wait > 0) await deps.sleep(wait)
      return json(status, { code })
    }
    const unavailable = (step: string, error?: unknown) => {
      deps.log(`phone-sign-in: ${step} failed (${error === undefined ? 'no code' : errorCode(error)})`)
      return fail(503, 'unavailable')
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (request.method !== 'POST') return fail(405, 'method_not_allowed')

    let phone: unknown
    let password: unknown
    try {
      const body: unknown = await request.json()
      if (typeof body === 'object' && body !== null) {
        phone = (body as { phone?: unknown }).phone
        password = (body as { password?: unknown }).password
      }
    } catch {
      return fail(400, 'invalid_request')
    }
    if (
      typeof phone !== 'string' ||
      typeof password !== 'string' ||
      phone.length > MAX_PHONE_LENGTH ||
      password.length === 0 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return fail(400, 'invalid_request')
    }

    let ip: string | null = null
    if (options.ipHeader !== null) {
      const value = request.headers.get(options.ipHeader)?.trim() ?? ''
      // The header was declared trustworthy; without a usable value something upstream
      // changed, so refuse rather than drop the IP limit.
      if (!IP_ADDRESS.test(value)) return unavailable('ip header')
      ip = value
    }

    // 2. The limit, before anything depends on the number being registered.
    let allowed: boolean
    try {
      allowed = await call(() => deps.checkLimit(phone as string, ip))
    } catch (error) {
      return unavailable('limit check', error)
    }
    if (allowed === false) return json(429, { code: 'rate_limited' })
    if (allowed !== true) return unavailable('limit check')

    // 3. The account.
    const normalized = normalizePhone(phone)
    if (normalized === null) return fail(400, 'invalid_credentials')

    let email: string | null
    try {
      const userId = await call(() => deps.findUserId(normalized))
      if (userId === null) return fail(400, 'invalid_credentials')
      email = await call(() => deps.findEmail(userId))
    } catch (error) {
      return unavailable('account lookup', error)
    }
    if (!email) return fail(400, 'invalid_credentials')

    let result: SignInResult
    try {
      result = await call(() => deps.signIn(email as string, password as string))
    } catch (error) {
      return unavailable('sign-in', error)
    }
    if (!result.ok) {
      if (result.code === 'invalid_credentials') return fail(400, 'invalid_credentials')
      if (result.code === 'email_not_confirmed') return fail(400, 'email_not_confirmed')
      // Including Auth's own rate limit: it is counted on this function's address, not the
      // caller's, so it is reported as unavailable rather than blamed on the caller.
      return unavailable('sign-in', { code: result.code ?? undefined })
    }

    // 4. The counter is cleared best effort: if that fails the number only stays stricter.
    try {
      await call(() => deps.recordSuccess(normalized))
    } catch (error) {
      deps.log(`phone-sign-in: clearing the counter failed (${errorCode(error)})`)
    }

    return json(200, { access_token: result.accessToken, refresh_token: result.refreshToken })
  }
}

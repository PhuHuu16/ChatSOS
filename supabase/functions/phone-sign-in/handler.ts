export type SignInResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; code: string | null }

export interface SignInDeps {
  checkLimit(phone: string, ip: string | null): Promise<boolean>
  recordSuccess(phone: string): Promise<void>
  findUserId(phone: string): Promise<string | null>
  findEmail(userId: string): Promise<string | null>
  signIn(email: string, password: string): Promise<SignInResult>
  log(message: string): void
  now(): number
  sleep(ms: number): Promise<void>
}

export interface HandlerOptions {
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

const IP_ADDRESS = /^(?:[0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9A-Fa-f:]{2,39}(?::[0-9]{1,3}(?:\.[0-9]{1,3}){3})?)$/

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/

// Chuẩn hóa số điện thoại
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

// Đăng nhập bằng số điện thoại
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
      if (!IP_ADDRESS.test(value)) return unavailable('ip header')
      ip = value
    }

    let allowed: boolean
    try {
      allowed = await call(() => deps.checkLimit(phone as string, ip))
    } catch (error) {
      return unavailable('limit check', error)
    }
    if (allowed === false) return json(429, { code: 'rate_limited' })
    if (allowed !== true) return unavailable('limit check')

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
      return unavailable('sign-in', { code: result.code ?? undefined })
    }

    try {
      await call(() => deps.recordSuccess(normalized))
    } catch (error) {
      deps.log(`phone-sign-in: clearing the counter failed (${errorCode(error)})`)
    }

    return json(200, { access_token: result.accessToken, refresh_token: result.refreshToken })
  }
}

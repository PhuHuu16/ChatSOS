// Unit tests of handler.ts with fake services:
//   node --test supabase/functions/phone-sign-in/handler.test.mjs
// (Node 22.18+ runs the .ts import directly).
//
// These test the request logic only. They do NOT show that the Edge Function works on
// Supabase: the Deno runtime, supabase-js, the keys, PostgREST, Auth and the real timing
// are all replaced here.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHandler, normalizePhone } from './handler.ts'

const REGISTERED = '0912 345 678'
const REGISTERED_STORED = '+84912345678'
const UNREGISTERED = '0399 999 999'
const PASSWORD = 'correct horse 1'
const EMAIL = 'someone@example.invalid'
const MIN_ERROR_MS = 1200

// Fake services. `calls` keeps the order; the clock only moves through `elapse` / sleep.
function setup(overrides = {}, options = {}) {
  const calls = []
  const logs = []
  let clock = 1_000_000
  const deps = {
    async checkLimit(phone, ip) {
      calls.push(['checkLimit', phone, ip])
      return true
    },
    async recordSuccess(phone) {
      calls.push(['recordSuccess', phone])
    },
    async findUserId(phone) {
      calls.push(['findUserId', phone])
      return phone === REGISTERED_STORED ? 'user-1' : null
    },
    async findEmail(userId) {
      calls.push(['findEmail', userId])
      return EMAIL
    },
    async signIn(email, password) {
      calls.push(['signIn', email])
      return password === PASSWORD
        ? { ok: true, accessToken: 'access-1', refreshToken: 'refresh-1' }
        : { ok: false, code: 'invalid_credentials' }
    },
    log: (message) => logs.push(message),
    now: () => clock,
    async sleep(ms) {
      calls.push(['sleep', ms])
      clock += ms
    },
    ...overrides,
  }
  const handle = createHandler(deps, {
    ipHeader: null,
    minErrorMs: MIN_ERROR_MS,
    callTimeoutMs: 50,
    ...options,
  })
  return {
    calls,
    logs,
    elapse: (ms) => {
      clock += ms
    },
    names: () => calls.map((c) => c[0]),
    elapsed: () => clock - 1_000_000,
    handle,
  }
}

function post(body, headers = {}) {
  return new Request('https://example.invalid/functions/v1/phone-sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function read(response) {
  return { status: response.status, body: await response.json() }
}

// Every value a log line must never contain.
function assertLogsClean(logs, extra = []) {
  for (const line of logs) {
    for (const secret of [REGISTERED, REGISTERED_STORED, '912345678', UNREGISTERED, '399999999',
      PASSWORD, EMAIL, 'access-1', 'refresh-1', ...extra]) {
      assert.ok(!line.includes(secret), `log line leaks a value: ${line}`)
    }
  }
}

test('success: limit checked first, counter cleared, only the two tokens returned', async () => {
  const t = setup()
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 200)
  assert.deepEqual(body, { access_token: 'access-1', refresh_token: 'refresh-1' })
  assert.deepEqual(t.names(), ['checkLimit', 'findUserId', 'findEmail', 'signIn', 'recordSuccess'])
  assert.deepEqual(t.calls[0], ['checkLimit', REGISTERED, null])
  assert.deepEqual(t.calls[4], ['recordSuccess', REGISTERED_STORED])
  assert.equal(t.elapsed(), 0, 'a success is not delayed')
})

test('unregistered number: the limit is checked before the lookup', async () => {
  const t = setup()
  const { status, body } = await read(await t.handle(post({ phone: UNREGISTERED, password: PASSWORD })))
  assert.equal(status, 400)
  assert.deepEqual(body, { code: 'invalid_credentials' })
  assert.deepEqual(t.names(), ['checkLimit', 'findUserId', 'sleep'])
})

test('unregistered number and wrong password give the same answer', async () => {
  const unknown = setup()
  const wrong = setup()
  const a = await read(await unknown.handle(post({ phone: UNREGISTERED, password: PASSWORD })))
  const b = await read(await wrong.handle(post({ phone: REGISTERED, password: 'wrong password' })))
  assert.deepEqual(a, b)
  assert.ok(!wrong.names().includes('recordSuccess'), 'a failure does not clear the counter')
})

test('a number that is not a mobile number is still counted, then refused', async () => {
  const t = setup()
  const { status, body } = await read(await t.handle(post({ phone: '0212 345 678', password: PASSWORD })))
  assert.equal(status, 400)
  assert.deepEqual(body, { code: 'invalid_credentials' })
  assert.deepEqual(t.names(), ['checkLimit', 'sleep'])
})

test('over the limit: 429 rate_limited, no lookup, registered or not', async () => {
  for (const phone of [REGISTERED, UNREGISTERED]) {
    const t = setup({
      async checkLimit(p, ip) {
        t.calls.push(['checkLimit', p, ip])
        return false
      },
    })
    const { status, body } = await read(await t.handle(post({ phone, password: PASSWORD })))
    assert.equal(status, 429)
    assert.deepEqual(body, { code: 'rate_limited' })
    assert.deepEqual(t.names(), ['checkLimit'], 'nothing after the limit')
  }
})

test('limiter error: 503 unavailable, no lookup, no sign-in', async () => {
  const t = setup({
    async checkLimit() {
      throw Object.assign(new Error(`connection failed for ${REGISTERED}`), { code: 'PGRST301' })
    },
  })
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 503)
  assert.deepEqual(body, { code: 'unavailable' })
  assert.deepEqual(t.names(), ['sleep'])
  assert.deepEqual(t.logs, ['phone-sign-in: limit check failed (PGRST301)'])
  assertLogsClean(t.logs)
})

test('limiter timeout: 503 unavailable, nothing after it', async () => {
  const t = setup({ checkLimit: () => new Promise(() => {}) })
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 503)
  assert.deepEqual(body, { code: 'unavailable' })
  assert.deepEqual(t.names(), ['sleep'])
  assert.deepEqual(t.logs, ['phone-sign-in: limit check failed (timeout)'])
})

test('limiter answering something other than true or false: refused', async () => {
  for (const answer of [null, undefined, 'true', 1]) {
    const t = setup({ checkLimit: async () => answer })
    const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
    assert.equal(status, 503)
    assert.deepEqual(body, { code: 'unavailable' })
    assert.ok(!t.names().includes('findUserId'))
  }
})

test('every error answer takes at least the minimum time', async () => {
  const cases = [
    setup(),
    setup({ checkLimit: async () => { throw new Error('x') } }),
    setup({ findUserId: async () => { throw new Error('x') } }),
  ]
  const requests = [
    post({ phone: UNREGISTERED, password: PASSWORD }),
    post({ phone: REGISTERED, password: PASSWORD }),
    post({ phone: REGISTERED, password: PASSWORD }),
  ]
  for (let i = 0; i < cases.length; i += 1) {
    const response = await cases[i].handle(requests[i])
    assert.ok(response.status >= 400)
    assert.equal(cases[i].elapsed(), MIN_ERROR_MS, `case ${i}`)
  }
})

test('the minimum time counts time already spent', async () => {
  const slow = setup({
    async signIn() {
      slow.elapse(900)
      return { ok: false, code: 'invalid_credentials' }
    },
  })
  await slow.handle(post({ phone: REGISTERED, password: 'wrong password' }))
  assert.deepEqual(slow.calls.at(-1), ['sleep', MIN_ERROR_MS - 900])
  assert.equal(slow.elapsed(), MIN_ERROR_MS)

  const slower = setup({
    async signIn() {
      slower.elapse(MIN_ERROR_MS + 300)
      return { ok: false, code: 'invalid_credentials' }
    },
  })
  await slower.handle(post({ phone: REGISTERED, password: 'wrong password' }))
  assert.ok(!slower.names().includes('sleep'), 'no extra wait once the minimum has passed')
})

test('Auth rate limit and other Auth errors: 503 unavailable, code logged only', async () => {
  for (const code of ['over_request_rate_limit', 'unexpected_failure', null]) {
    const t = setup({ signIn: async () => ({ ok: false, code }) })
    const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
    assert.equal(status, 503)
    assert.deepEqual(body, { code: 'unavailable' })
    assert.deepEqual(t.logs, [`phone-sign-in: sign-in failed (${code ?? 'no code'})`])
    assert.ok(!t.names().includes('recordSuccess'))
  }
})

test('email not confirmed is passed on', async () => {
  const t = setup({ signIn: async () => ({ ok: false, code: 'email_not_confirmed' }) })
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 400)
  assert.deepEqual(body, { code: 'email_not_confirmed' })
})

test('account without an email: same answer as an unknown number', async () => {
  const t = setup({ findEmail: async () => null })
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 400)
  assert.deepEqual(body, { code: 'invalid_credentials' })
  assert.ok(!t.names().includes('signIn'))
})

test('lookup failures: 503 unavailable with a code only', async () => {
  const t = setup({
    findEmail: async () => {
      throw Object.assign(new Error(`user ${EMAIL} not found`), { status: 404 })
    },
  })
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 503)
  assert.deepEqual(body, { code: 'unavailable' })
  assert.deepEqual(t.logs, ['phone-sign-in: account lookup failed (status 404)'])
  assertLogsClean(t.logs)
})

test('clearing the counter failing does not undo a success', async () => {
  const t = setup({
    recordSuccess: async () => {
      throw Object.assign(new Error('x'), { code: '57014' })
    },
  })
  const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD })))
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body).sort(), ['access_token', 'refresh_token'])
  assert.deepEqual(t.logs, ['phone-sign-in: clearing the counter failed (57014)'])
})

test('bad requests are refused before the limiter (nothing to count)', async () => {
  const bodies = [
    'not json',
    'null',
    '[]',
    {},
    { phone: REGISTERED },
    { phone: REGISTERED, password: '' },
    { phone: 912345678, password: PASSWORD },
    { phone: '0'.repeat(33), password: PASSWORD },
    { phone: REGISTERED, password: 'x'.repeat(1025) },
  ]
  for (const body of bodies) {
    const t = setup()
    const { status, body: answer } = await read(await t.handle(post(body)))
    assert.equal(status, 400, JSON.stringify(body))
    assert.deepEqual(answer, { code: 'invalid_request' })
    assert.deepEqual(t.names(), ['sleep'])
  }
})

test('OPTIONS answers CORS at once; other methods are refused', async () => {
  const t = setup()
  const options = await t.handle(new Request('https://example.invalid/', { method: 'OPTIONS' }))
  assert.equal(options.status, 204)
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*')
  assert.match(options.headers.get('Access-Control-Allow-Headers'), /apikey/)
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
  assert.equal(t.calls.length, 0)

  const get = await read(await t.handle(new Request('https://example.invalid/', { method: 'GET' })))
  assert.deepEqual(get, { status: 405, body: { code: 'method_not_allowed' } })
  assert.ok(!t.names().includes('checkLimit'))
})

test('error answers carry only the code and the CORS headers', async () => {
  const t = setup()
  const response = await t.handle(post({ phone: UNREGISTERED, password: PASSWORD }))
  assert.equal(response.headers.get('Content-Type'), 'application/json')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.deepEqual(Object.keys(await response.json()), ['code'])
})

test('no IP header configured: forwarded headers are ignored', async () => {
  const t = setup()
  await t.handle(post({ phone: REGISTERED, password: PASSWORD }, {
    'X-Forwarded-For': '198.51.100.1',
    'CF-Connecting-IP': '198.51.100.2',
  }))
  assert.deepEqual(t.calls[0], ['checkLimit', REGISTERED, null])
})

test('IP header configured: its value is passed to the limiter', async () => {
  const t = setup({}, { ipHeader: 'cf-connecting-ip' })
  await t.handle(post({ phone: REGISTERED, password: PASSWORD }, { 'CF-Connecting-IP': ' 198.51.100.2 ' }))
  assert.deepEqual(t.calls[0], ['checkLimit', REGISTERED, '198.51.100.2'])

  const v6 = setup({}, { ipHeader: 'cf-connecting-ip' })
  await v6.handle(post({ phone: REGISTERED, password: PASSWORD }, { 'CF-Connecting-IP': '2001:db8::1' }))
  assert.deepEqual(v6.calls[0], ['checkLimit', REGISTERED, '2001:db8::1'])
})

test('IP header configured but missing or not one address: refused, not skipped', async () => {
  for (const value of [undefined, '', 'unknown', '198.51.100.1, 203.0.113.9', '1'.repeat(70)]) {
    const t = setup({}, { ipHeader: 'cf-connecting-ip' })
    const headers = value === undefined ? {} : { 'CF-Connecting-IP': value }
    const { status, body } = await read(await t.handle(post({ phone: REGISTERED, password: PASSWORD }, headers)))
    assert.equal(status, 503, String(value))
    assert.deepEqual(body, { code: 'unavailable' })
    assert.ok(!t.names().includes('checkLimit'))
    assertLogsClean(t.logs, ['198.51.100.1'])
  }
})

test('many requests at once each reach the limiter before any lookup', async () => {
  let allowedLeft = 5
  const t = setup({
    async checkLimit(phone, ip) {
      t.calls.push(['checkLimit', phone, ip])
      await new Promise((resolve) => setTimeout(resolve, 1))
      allowedLeft -= 1
      return allowedLeft >= 0
    },
  })
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => t.handle(post({ phone: UNREGISTERED, password: PASSWORD }))),
  )
  const statuses = responses.map((r) => r.status)
  assert.equal(statuses.filter((s) => s === 429).length, 15)
  assert.equal(statuses.filter((s) => s === 400).length, 5)
  assert.equal(t.names().filter((n) => n === 'findUserId').length, 5)
})

test('normalizePhone matches the app and the database', () => {
  assert.equal(normalizePhone('0912 345 678'), '+84912345678')
  assert.equal(normalizePhone('84912345678'), '+84912345678')
  assert.equal(normalizePhone('+84 (91) 234-5678'), '+84912345678')
  assert.equal(normalizePhone('0212345678'), null)
  assert.equal(normalizePhone('09123456789'), null)
  assert.equal(normalizePhone(''), null)
})

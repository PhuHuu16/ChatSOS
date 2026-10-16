// Checks the Supabase settings the browser bundle is built with, so a misconfiguration
// such as a pasted secret key fails loudly instead of shipping. It only reads the JWT
// payload to see the role; it does not verify signatures and is not an authentication
// or authorization control. Messages never include the URL or key value.

export interface SupabaseConfig {
  url: string
  key: string
}

export class SupabaseConfigError extends Error {
  name = 'SupabaseConfigError'
}

const URL_VAR = 'VITE_SUPABASE_URL'
const KEY_VAR = 'VITE_SUPABASE_PUBLISHABLE_KEY'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const SECRET_KEY_MESSAGE = `${KEY_VAR} looks like a secret key. Use the publishable (sb_publishable_…) key; a secret key must never reach the browser.`

export function validateSupabaseConfig(
  url: string | undefined,
  key: string | undefined,
): SupabaseConfig {
  return { url: validateUrl(url), key: validateKey(key) }
}

function validateUrl(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new SupabaseConfigError(`${URL_VAR} is not set. Copy .env.example to .env.local and fill it in.`)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new SupabaseConfigError(`${URL_VAR} is not a valid URL.`)
  }

  const isLocal = parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)
  if (parsed.protocol !== 'https:' && !isLocal) {
    throw new SupabaseConfigError(`${URL_VAR} must use https (plain http is allowed only for localhost).`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new SupabaseConfigError(
      `${URL_VAR} must be the project URL only, without credentials, path, query or fragment.`,
    )
  }
  return trimmed
}

function validateKey(value: string | undefined): string {
  const key = value?.trim()
  if (!key) {
    throw new SupabaseConfigError(`${KEY_VAR} is not set. Copy .env.example to .env.local and fill it in.`)
  }
  if (key.startsWith('sb_secret_')) throw new SupabaseConfigError(SECRET_KEY_MESSAGE)
  if (PUBLISHABLE_KEY.test(key)) return key

  // Legacy keys are JWTs; only the anon one is meant for clients.
  if (JWT.test(key)) {
    const role = readJwtRole(key)
    if (role === 'anon') return key
    if (role === 'service_role') throw new SupabaseConfigError(SECRET_KEY_MESSAGE)
    throw new SupabaseConfigError(`${KEY_VAR} is a JWT without the "anon" role. Use the publishable key.`)
  }

  throw new SupabaseConfigError(`${KEY_VAR} is not a Supabase publishable key (expected sb_publishable_…).`)
}

function readJwtRole(jwt: string): string | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const json: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    if (typeof json === 'object' && json !== null && 'role' in json && typeof json.role === 'string') {
      return json.role
    }
    return null
  } catch {
    return null
  }
}

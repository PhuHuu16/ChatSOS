import type { Translation } from '../../i18n/locales/vi'

type ChatErrorName = keyof Translation['chat']['errors']
export type ChatErrorKey = `chat.errors.${ChatErrorName}`

export type ChatAction = 'load' | 'send' | 'create' | 'change' | 'delete' | 'phoneSearch'

// Raised by the messages_guard_update trigger once a message is too old to change.
const CHANGE_WINDOW_PASSED = 'CS001'
// Raised by find_profile_by_phone over its lookup limit (migration 11); PostgREST answers
// HTTP 429. Counted before the search, so it says nothing about the number searched.
const LOOKUP_LIMIT_REACHED = 'PT429'

// Uses only the HTTP status and the SQLSTATE / PostgREST code. The error message text is
// never matched or shown: it is not a stable contract.
export function toChatErrorKey(
  status: number,
  code: string | undefined,
  action: ChatAction,
): ChatErrorKey {
  // postgrest-js reports "no HTTP response" (network failure, aborted request) as status 0.
  if (status === 0) return 'chat.errors.network'
  // 42501: RLS or privilege refusal. 401: missing or expired session.
  if (code === '42501' || status === 401 || status === 403) return 'chat.errors.notAllowed'
  if (action === 'phoneSearch') {
    return code === LOOKUP_LIMIT_REACHED || status === 429
      ? 'chat.errors.phoneSearchLimited'
      : 'chat.errors.loadFailed'
  }
  if (action === 'change') {
    return code === CHANGE_WINDOW_PASSED ? 'chat.errors.changeExpired' : 'chat.errors.changeFailed'
  }
  if (action === 'create') return 'chat.errors.createFailed'
  if (action === 'delete') return 'chat.errors.deleteFailed'
  return action === 'load' ? 'chat.errors.loadFailed' : 'chat.errors.sendFailed'
}

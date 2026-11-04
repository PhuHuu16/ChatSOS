import type { Translation } from '../../i18n/locales/vi'

type ChatErrorName = keyof Translation['chat']['errors']
export type ChatErrorKey = `chat.errors.${ChatErrorName}`

export type ChatAction = 'load' | 'send' | 'create' | 'change' | 'delete' | 'phoneSearch' | 'group'

const CHANGE_WINDOW_PASSED = 'CS001'
const LOOKUP_LIMIT_REACHED = 'PT429'
const GROUP_FULL = 'CS002'
const GROUP_NOT_FOUND = 'P0002'

export function toChatErrorKey(
  status: number,
  code: string | undefined,
  action: ChatAction,
): ChatErrorKey {
  if (status === 0) return 'chat.errors.network'
  if (code === '42501' || status === 401 || status === 403) return 'chat.errors.notAllowed'
  if (action === 'phoneSearch') {
    return code === LOOKUP_LIMIT_REACHED || status === 429
      ? 'chat.errors.phoneSearchLimited'
      : 'chat.errors.loadFailed'
  }
  if (action === 'group') {
    if (code === GROUP_FULL) return 'chat.errors.groupFull'
    if (code === GROUP_NOT_FOUND) return 'chat.errors.groupGone'
    return 'chat.errors.groupChangeFailed'
  }
  if (action === 'change') {
    return code === CHANGE_WINDOW_PASSED ? 'chat.errors.changeExpired' : 'chat.errors.changeFailed'
  }
  if (action === 'create') return 'chat.errors.createFailed'
  if (action === 'delete') return 'chat.errors.deleteFailed'
  return action === 'load' ? 'chat.errors.loadFailed' : 'chat.errors.sendFailed'
}

import type { TFunction } from 'i18next'
import { findUser } from './helpers'
import type { Message, User } from './types'

export function systemMessageText(
  t: TFunction,
  message: Message,
  users: User[],
  currentUserId: string,
): string {
  const system = message.system
  if (!system) return ''
  const name = (id: string | null, subject: boolean) => {
    if (id === currentUserId) return t(subject ? 'chat.system.you' : 'chat.system.youObject')
    const user = id === null ? undefined : findUser(users, id)
    return user?.displayName || t(subject ? 'chat.system.someone' : 'chat.system.someoneObject')
  }
  return t(`chat.system.${system.event}`, {
    actor: name(message.senderId, true),
    target: name(system.targetId, false),
    title: message.content,
  })
}

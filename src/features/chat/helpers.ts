import type { Conversation, Message, User } from './types'

// Full class names so Tailwind can find them when scanning the source.
const AVATAR_COLORS = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-teal-500',
] as const

export function findUser(users: User[], id: string): User | undefined {
  return users.find((user) => user.id === id)
}

export function getConversationTitle(
  conversation: Conversation,
  users: User[],
  currentUserId: string,
): string {
  if (conversation.type === 'group') return conversation.title ?? ''
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  return (otherId && findUser(users, otherId)?.displayName) || ''
}

// Oldest first; the id breaks ties, like the server's ordering.
export function compareMessages(a: Message, b: Message): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  if (byTime !== 0) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function getMessages(messages: Message[], conversationId: string): Message[] {
  return messages
    .filter((message) => message.conversationId === conversationId)
    .sort(compareMessages)
}

export function getLastMessage(messages: Message[], conversationId: string): Message | undefined {
  return getMessages(messages, conversationId).at(-1)
}

// Newest activity first, counting `messages` that are newer than a conversation's
// lastActivityAt (e.g. sent since the list loaded). Equal activity keeps the given order.
export function sortByActivity(conversations: Conversation[], messages: Message[]): Conversation[] {
  const latest = new Map<string, number>()
  for (const message of messages) {
    const time = Date.parse(message.createdAt)
    if (time > (latest.get(message.conversationId) ?? -Infinity)) {
      latest.set(message.conversationId, time)
    }
  }
  const activity = (conversation: Conversation) =>
    Math.max(Date.parse(conversation.lastActivityAt), latest.get(conversation.id) ?? -Infinity)
  return [...conversations].sort((a, b) => activity(b) - activity(a))
}

export function formatTime(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.charAt(0) ?? ''
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

export function getAvatarColorClass(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}

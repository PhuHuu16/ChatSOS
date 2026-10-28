import type { Conversation, Message, UnreadMessage, User } from './types'

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

// Microseconds since the epoch of a server timestamp. Postgres keeps microseconds, which
// Date drops, so messages written in the same millisecond still compare correctly.
export function timestampMicros(iso: string): number {
  const ms = Date.parse(iso)
  const fraction = /T[^.+Z-]*\.(\d+)/.exec(iso)?.[1]
  if (!fraction) return ms * 1000
  return Math.floor(ms / 1000) * 1_000_000 + Number(fraction.padEnd(6, '0').slice(0, 6))
}

// Oldest first; the id breaks ties, like the server's ordering.
export function compareMessages(a: Message, b: Message): number {
  const byTime = timestampMicros(a.createdAt) - timestampMicros(b.createdAt)
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

// `loaded` (oldest first) plus the `live` messages of this conversation it does not have
// yet (sent or received since it loaded). When `loaded` is a full page it may not reach
// back to older live messages; those are left out so no gap appears before the page.
export function withLiveMessages(
  loaded: Message[],
  live: Message[],
  conversationId: string,
  pageSize: number,
): Message[] {
  const loadedIds = new Set(loaded.map((message) => message.id))
  const oldest = loaded.length >= pageSize ? loaded[0] : undefined
  const seen = new Set<string>()
  const extra = live.filter((message) => {
    if (message.conversationId !== conversationId || loadedIds.has(message.id)) return false
    if (seen.has(message.id) || (oldest && compareMessages(message, oldest) <= 0)) return false
    seen.add(message.id)
    return true
  })
  if (extra.length === 0) return loaded
  return [...loaded, ...extra].sort(compareMessages)
}

// The later of two read markers (ISO 8601, either may be missing).
export function laterReadMarker(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return timestampMicros(b) > timestampMicros(a) ? b : a
}

// Unread count per conversation: the unread messages loaded with the list plus messages
// from others received since, minus those at or before the read marker. `readMarkers`
// holds markers set in this session, which may be newer than the loaded ones.
export function countUnread(
  conversations: Conversation[],
  unread: UnreadMessage[],
  live: Message[],
  currentUserId: string,
  readMarkers: ReadonlyMap<string, string>,
): Map<string, number> {
  const readAt = new Map<string, number>()
  for (const conversation of conversations) {
    const marker = laterReadMarker(conversation.lastReadAt, readMarkers.get(conversation.id))
    readAt.set(conversation.id, marker === null ? -Infinity : timestampMicros(marker))
  }
  const idsByConversation = new Map<string, Set<string>>()
  const candidates = [...unread, ...live.filter((message) => message.senderId !== currentUserId)]
  for (const message of candidates) {
    const marker = readAt.get(message.conversationId)
    if (marker === undefined || timestampMicros(message.createdAt) <= marker) continue
    const ids = idsByConversation.get(message.conversationId) ?? new Set<string>()
    ids.add(message.id)
    idsByConversation.set(message.conversationId, ids)
  }
  return new Map([...idsByConversation].map(([id, ids]) => [id, ids.size]))
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

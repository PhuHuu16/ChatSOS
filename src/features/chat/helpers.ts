import type { Conversation, Message, UnreadMessage, User } from './types'

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

export function messageUserIds(messages: Message[]): string[] {
  const ids = new Set<string>()
  for (const message of messages) {
    ids.add(message.senderId)
    if (message.system?.targetId) ids.add(message.system.targetId)
  }
  return [...ids]
}

export function unknownUserIds(messages: Message[], users: User[]): string[] {
  const known = new Set(users.map((user) => user.id))
  return messageUserIds(messages).filter((id) => !known.has(id))
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

export function getConversationAvatarPath(
  conversation: Conversation,
  users: User[],
  currentUserId: string,
): string | null {
  if (conversation.type === 'group') return null
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  return (otherId && findUser(users, otherId)?.avatarPath) || null
}

export function timestampMicros(iso: string): number {
  const ms = Date.parse(iso)
  const fraction = /T[^.+Z-]*\.(\d+)/.exec(iso)?.[1]
  if (!fraction) return ms * 1000
  return Math.floor(ms / 1000) * 1_000_000 + Number(fraction.padEnd(6, '0').slice(0, 6))
}

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

export function withLiveMessages(
  loaded: Message[],
  live: Message[],
  conversationId: string,
  complete: boolean,
): Message[] {
  const loadedIds = new Set(loaded.map((message) => message.id))
  const oldest = complete ? undefined : loaded[0]
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

export function laterReadMarker(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return timestampMicros(b) > timestampMicros(a) ? b : a
}

// Đếm tin chưa đọc
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
  const candidates = [
    ...unread,
    ...live.filter((message) => message.senderId !== currentUserId && message.kind !== 'system'),
  ]
  for (const message of candidates) {
    const marker = readAt.get(message.conversationId)
    if (marker === undefined || timestampMicros(message.createdAt) <= marker) continue
    const ids = idsByConversation.get(message.conversationId) ?? new Set<string>()
    ids.add(message.id)
    idsByConversation.set(message.conversationId, ids)
  }
  return new Map([...idsByConversation].map(([id, ids]) => [id, ids.size]))
}

export function readersOf(
  message: Pick<Message, 'createdAt'>,
  readMarkers: ReadonlyMap<string, string | null>,
): string[] {
  const sent = timestampMicros(message.createdAt)
  return [...readMarkers]
    .filter(([, marker]) => marker !== null && timestampMicros(marker) >= sent)
    .map(([id]) => id)
}

export function newerVersion(a: Message, b: Message): Message {
  if (a.deletedAt !== null || b.deletedAt !== null) return a.deletedAt !== null ? a : b
  const editedA = a.editedAt === null ? -Infinity : timestampMicros(a.editedAt)
  const editedB = b.editedAt === null ? -Infinity : timestampMicros(b.editedAt)
  return editedB > editedA ? b : a
}

export function withUpdate(
  updates: ReadonlyMap<string, Message>,
  message: Message,
): ReadonlyMap<string, Message> {
  const known = updates.get(message.id)
  const next = known ? newerVersion(known, message) : message
  return next === known ? updates : new Map(updates).set(message.id, next)
}

export function withUpdates(
  messages: Message[],
  updates: ReadonlyMap<string, Message>,
): Message[] {
  if (updates.size === 0) return messages
  let changed = false
  const result = messages.map((message) => {
    const update = updates.get(message.id)
    const newer = update ? newerVersion(message, update) : message
    if (newer !== message) changed = true
    return newer
  })
  return changed ? result : messages
}

export function afterClear<T extends { conversationId: string; createdAt: string }>(
  messages: T[],
  clears: ReadonlyMap<string, string>,
): T[] {
  if (clears.size === 0) return messages
  const kept = messages.filter((message) => {
    const mark = clears.get(message.conversationId)
    return mark === undefined || timestampMicros(message.createdAt) > timestampMicros(mark)
  })
  return kept.length === messages.length ? messages : kept
}

export function isListed(
  conversation: Conversation,
  clears: ReadonlyMap<string, string>,
  lastMessages: Message[],
): boolean {
  if (!clears.has(conversation.id)) return true
  return lastMessages.some((message) => message.conversationId === conversation.id)
}

function laterTime(a: string | undefined, b: string | null): string | undefined {
  if (b === null) return a
  if (a === undefined) return b
  return timestampMicros(a) >= timestampMicros(b) ? a : b
}

export function clearMarks(
  conversations: Conversation[],
  session: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const marks = new Map<string, string>()
  for (const conversation of conversations) {
    const mark = laterTime(session.get(conversation.id), conversation.clearedAt)
    if (mark !== undefined) marks.set(conversation.id, mark)
  }
  return marks
}

export type RecallBlock = 'notOwn' | 'recalled' | 'expired'

export function recallBlock(
  messages: Message[],
  userId: string,
  now: number,
  windowMs: number,
): RecallBlock | null {
  if (messages.some((message) => message.senderId !== userId)) return 'notOwn'
  if (messages.some((message) => message.deletedAt !== null)) return 'recalled'
  if (messages.some((message) => now - Date.parse(message.createdAt) >= windowMs)) {
    return 'expired'
  }
  return null
}

export function withoutHidden<T extends { id: string }>(
  messages: T[],
  hidden: ReadonlySet<string>,
): T[] {
  if (hidden.size === 0 || !messages.some((message) => hidden.has(message.id))) return messages
  return messages.filter((message) => !hidden.has(message.id))
}

export function mergeMessages(...lists: Message[][]): Message[] {
  const byId = new Map<string, Message>()
  for (const list of lists) for (const message of list) byId.set(message.id, message)
  return [...byId.values()].sort(compareMessages)
}

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

// Định dạng thời gian
export function formatTime(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000

function localMidnight(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function daysAgo(iso: string, now: number): number {
  return Math.round((localMidnight(now) - localMidnight(Date.parse(iso))) / 86_400_000)
}

export function formatDay(iso: string, language: string, now: number): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

export function startsGroup(
  previous: Pick<Message, 'senderId' | 'kind' | 'createdAt'> | undefined,
  message: Pick<Message, 'senderId' | 'kind' | 'createdAt'>,
): boolean {
  if (!previous || previous.kind === 'system' || message.kind === 'system') return true
  if (previous.senderId !== message.senderId) return true
  const gap = Date.parse(message.createdAt) - Date.parse(previous.createdAt)
  if (gap > MESSAGE_GROUP_GAP_MS || gap < 0) return true
  return daysAgo(previous.createdAt, Date.parse(message.createdAt)) !== 0
}

function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

// Tìm kiếm
export function matchesSearch(text: string, query: string): boolean {
  const needle = foldForSearch(query.trim())
  return needle === '' || foldForSearch(text).includes(needle)
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

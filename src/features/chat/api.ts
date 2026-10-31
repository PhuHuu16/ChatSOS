// Reads and writes for the chat screens. Every request runs as the signed-in user, so RLS
// already limits rows to conversations the user belongs to; nothing here filters by user id.
import { supabase } from '../../lib/supabase'
import { normalizePhone } from '../auth/validation'
import type { Database } from '../../types/database'
import { toChatErrorKey, type ChatAction, type ChatErrorKey } from './chatErrors'
import { messageUserIds } from './helpers'
import type {
  Attachment,
  Conversation,
  MemberRead,
  Message,
  Profile,
  Removal,
  SystemEvent,
  UnreadMessage,
  User,
} from './types'

type MessageRow = Pick<
  Database['public']['Tables']['messages']['Row'],
  | 'id'
  | 'conversation_id'
  | 'sender_id'
  | 'kind'
  | 'content'
  | 'attachment_path'
  | 'attachment_name'
  | 'attachment_size'
  | 'attachment_mime'
  | 'created_at'
  | 'edited_at'
  | 'deleted_at'
  | 'system_event'
  | 'system_target_id'
>

// Same limit as the messages_content_length check (char_length counts code points).
export const MESSAGE_MAX_LENGTH = 4000
export const MESSAGE_PAGE_SIZE = 50
// Unread messages loaded per conversation; the badge shows "99+" beyond 99.
export const UNREAD_LIMIT = 100
// Keeps each `id=in.(...)` request URL well under server limits.
const PROFILE_BATCH_SIZE = 100

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, kind, content, attachment_path, attachment_name, attachment_size, attachment_mime, created_at, edited_at, deleted_at, system_event, system_target_id'

export type ChatResult<T> = { ok: true; data: T } | { ok: false; error: ChatErrorKey }

export interface ConversationList {
  // Newest activity first: last message time, or creation time when there is none yet.
  conversations: Conversation[]
  // Every member of the listed conversations, including the current user.
  users: User[]
  // The newest message of each conversation that has one.
  lastMessages: Message[]
  // Up to UNREAD_LIMIT newest unread messages per conversation.
  unread: UnreadMessage[]
}

interface FailedResponse {
  status: number
  error: { code?: string } | null
}

function fail(response: FailedResponse, action: ChatAction): { ok: false; error: ChatErrorKey } {
  return { ok: false, error: toChatErrorKey(response.status, response.error?.code, action) }
}

function toAttachment(row: MessageRow): Attachment | null {
  const { attachment_path: path, attachment_name: name, attachment_size: size } = row
  const mime = row.attachment_mime
  // The messages_kind_consistency check sets all four or none.
  if (path === null || name === null || size === null || mime === null) return null
  return { path, name, size, mime }
}

function toMessage(row: MessageRow): Message {
  const message: Message = {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    content: row.content,
    attachment: row.kind === 'image' || row.kind === 'file' ? toAttachment(row) : null,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  }
  // The messages_kind_consistency check sets system_event exactly for system messages.
  if (row.kind === 'system' && row.system_event !== null) {
    message.system = { event: row.system_event, targetId: row.system_target_id }
  }
  return message
}

const MESSAGE_KINDS: ReadonlySet<string> = new Set<MessageRow['kind']>([
  'text',
  'image',
  'file',
  'system',
])

function isMessageKind(kind: string): kind is MessageRow['kind'] {
  return MESSAGE_KINDS.has(kind)
}

const SYSTEM_EVENTS: ReadonlySet<string> = new Set<SystemEvent>([
  'member_added',
  'member_removed',
  'member_left',
  'title_changed',
  'owner_changed',
])

function isSystemEvent(event: unknown): event is SystemEvent {
  return typeof event === 'string' && SYSTEM_EVENTS.has(event)
}

// The new row of a Realtime INSERT or UPDATE event on messages, or null when the event
// carries no usable row (e.g. an error event, which has no record).
export function parseMessageRow(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const { id, conversation_id, sender_id, kind, content, created_at } = row
  if (
    typeof id !== 'string' ||
    typeof conversation_id !== 'string' ||
    typeof sender_id !== 'string' ||
    typeof kind !== 'string' ||
    !isMessageKind(kind) ||
    typeof content !== 'string' ||
    typeof created_at !== 'string' ||
    Number.isNaN(Date.parse(created_at))
  ) {
    return null
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  const time = (value: unknown) =>
    typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
  // bigint may arrive as a number or a numeric string.
  const size = Number(row.attachment_size)
  const message = toMessage({
    id,
    conversation_id,
    sender_id,
    kind,
    content,
    attachment_path: text(row.attachment_path),
    attachment_name: text(row.attachment_name),
    attachment_size: row.attachment_size == null || !Number.isFinite(size) ? null : size,
    attachment_mime: text(row.attachment_mime),
    created_at,
    edited_at: time(row.edited_at),
    deleted_at: time(row.deleted_at),
    system_event: isSystemEvent(row.system_event) ? row.system_event : null,
    system_target_id: text(row.system_target_id),
  })
  // An image or file message without its attachment cannot be shown, unless recalled.
  const hasFile = kind === 'image' || kind === 'file'
  if (hasFile && message.attachment === null && message.deletedAt === null) return null
  // Nor a system message without a known event (e.g. one added by a newer migration).
  if (kind === 'system' && !message.system) return null
  return message
}

// The row of a Realtime event on conversation_removals, or null when it has no usable row.
// Realtime sends the user only their own rows (RLS).
export function parseRemovalRow(value: unknown): Removal | null {
  if (typeof value !== 'object' || value === null) return null
  const { conversation_id, removed_at } = value as Record<string, unknown>
  if (typeof conversation_id !== 'string' || typeof removed_at !== 'string') return null
  if (Number.isNaN(Date.parse(removed_at))) return null
  return { conversationId: conversation_id, removedAt: removed_at }
}

// The row of a Realtime event on conversation_members, or null when it has no usable row.
export function parseMemberRow(value: unknown): MemberRead | null {
  if (typeof value !== 'object' || value === null) return null
  const { conversation_id, user_id, last_read_at } = value as Record<string, unknown>
  if (typeof conversation_id !== 'string' || typeof user_id !== 'string') return null
  const valid = typeof last_read_at === 'string' && !Number.isNaN(Date.parse(last_read_at))
  return { conversationId: conversation_id, userId: user_id, lastReadAt: valid ? last_read_at : null }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// The profiles of these users. Any signed-in user can read every profile, so this also
// names people who have left a group, e.g. in its system messages. Deleted accounts are
// simply missing from the answer.
export async function fetchUsers(ids: string[]): Promise<ChatResult<User[]>> {
  const unique = [...new Set(ids)]
  const responses = await Promise.all(
    chunk(unique, PROFILE_BATCH_SIZE).map((batch) =>
      supabase.from('profiles').select('id, display_name, avatar_path').in('id', batch),
    ),
  )
  const users: User[] = []
  for (const response of responses) {
    if (response.error) return fail(response, 'load')
    for (const profile of response.data) {
      users.push({
        id: profile.id,
        displayName: profile.display_name,
        avatarPath: profile.avatar_path,
      })
    }
  }
  return { ok: true, data: users }
}

// `userId` is the signed-in user: it picks their read markers and leaves out their own
// messages when counting unread ones.
export async function fetchConversationList(
  userId: string,
): Promise<ChatResult<ConversationList>> {
  const conversationsResponse = await supabase
    .from('conversations')
    .select('id, type, title, created_at, last_message_at')
  if (conversationsResponse.error) return fail(conversationsResponse, 'load')
  const rows = conversationsResponse.data
  if (rows.length === 0) {
    return { ok: true, data: { conversations: [], users: [], lastMessages: [], unread: [] } }
  }

  // RLS returns the members of the caller's conversations only.
  const membersResponse = await supabase
    .from('conversation_members')
    .select('conversation_id, user_id, role, last_read_at')
  if (membersResponse.error) return fail(membersResponse, 'load')

  // RLS returns the caller's own marks only.
  const clearsResponse = await supabase
    .from('conversation_clears')
    .select('conversation_id, cleared_at')
  if (clearsResponse.error) return fail(clearsResponse, 'load')
  const clearedAt = new Map(clearsResponse.data.map((row) => [row.conversation_id, row.cleared_at]))

  const memberIdsByConversation = new Map<string, string[]>()
  const lastReadAt = new Map<string, string | null>()
  const memberReadAt = new Map<string, Record<string, string | null>>()
  // The conversation_members_one_owner index allows one owner per group.
  const ownerId = new Map<string, string>()
  for (const member of membersResponse.data) {
    if (member.role === 'owner') ownerId.set(member.conversation_id, member.user_id)
    const ids = memberIdsByConversation.get(member.conversation_id) ?? []
    ids.push(member.user_id)
    memberIdsByConversation.set(member.conversation_id, ids)
    const reads = memberReadAt.get(member.conversation_id) ?? {}
    reads[member.user_id] = member.last_read_at
    memberReadAt.set(member.conversation_id, reads)
    if (member.user_id === userId) lastReadAt.set(member.conversation_id, member.last_read_at)
  }

  // One small request per conversation that has messages: PostgREST has no
  // "newest row per group" query. Fine for the MVP's conversation counts.
  const lastMessageResponses = await Promise.all(
    rows
      .filter((row) => row.last_message_at !== null)
      .map((row) =>
        supabase
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id', row.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1),
      ),
  )
  const lastMessages: Message[] = []
  for (const response of lastMessageResponses) {
    if (response.error) return fail(response, 'load')
    const row = response.data[0]
    if (row) lastMessages.push(toMessage(row))
  }

  // Every member, plus whoever a last message names who is no longer a member.
  const usersResponse = await fetchUsers([
    ...membersResponse.data.map((member) => member.user_id),
    ...messageUserIds(lastMessages),
  ])
  if (!usersResponse.ok) return usersResponse
  const users = usersResponse.data

  // Only conversations with a message after the read marker can have unread messages.
  // System messages ("A added B") never count as unread.
  const unreadResponses = await Promise.all(
    rows
      .filter((row) => {
        if (row.last_message_at === null) return false
        const readAt = lastReadAt.get(row.id) ?? null
        return readAt === null || Date.parse(row.last_message_at) >= Date.parse(readAt)
      })
      .map((row) => {
        const readAt = lastReadAt.get(row.id) ?? null
        let query = supabase
          .from('messages')
          .select('id, conversation_id, created_at')
          .eq('conversation_id', row.id)
          .neq('sender_id', userId)
          .neq('kind', 'system')
        if (readAt !== null) query = query.gt('created_at', readAt)
        return query.order('created_at', { ascending: false }).limit(UNREAD_LIMIT)
      }),
  )
  const unread: UnreadMessage[] = []
  for (const response of unreadResponses) {
    if (response.error) return fail(response, 'load')
    for (const row of response.data) {
      unread.push({ id: row.id, conversationId: row.conversation_id, createdAt: row.created_at })
    }
  }

  const activity = (row: (typeof rows)[number]) => Date.parse(row.last_message_at ?? row.created_at)
  const conversations: Conversation[] = [...rows]
    .sort((a, b) => activity(b) - activity(a))
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      memberIds: memberIdsByConversation.get(row.id) ?? [],
      ownerId: row.type === 'group' ? (ownerId.get(row.id) ?? null) : null,
      lastActivityAt: row.last_message_at ?? row.created_at,
      lastReadAt: lastReadAt.get(row.id) ?? null,
      memberReadAt: memberReadAt.get(row.id) ?? {},
      clearedAt: clearedAt.get(row.id) ?? null,
    }))

  return { ok: true, data: { conversations, users, lastMessages, unread } }
}

// The newest MESSAGE_PAGE_SIZE messages of a conversation, oldest first. An empty list
// also covers a conversation the caller cannot read: RLS hides it rather than failing.
export async function fetchMessages(conversationId: string): Promise<ChatResult<Message[]>> {
  const response = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE)
  if (response.error) return fail(response, 'load')
  return { ok: true, data: response.data.map(toMessage).reverse() }
}

// The MESSAGE_PAGE_SIZE messages just before `before`, oldest first. Ties on created_at are
// ordered by id, like every message query, so no message is skipped or repeated.
export async function fetchMessagesBefore(
  conversationId: string,
  before: Pick<Message, 'id' | 'createdAt'>,
): Promise<ChatResult<Message[]>> {
  const time = `"${before.createdAt}"`
  const response = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${before.id})`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE)
  if (response.error) return fail(response, 'load')
  return { ok: true, data: response.data.map(toMessage).reverse() }
}

export type TextMessageCheck =
  | { ok: true; content: string }
  | { ok: false; error: 'chat.errors.messageEmpty' | 'chat.errors.messageTooLong' }

// Mirrors the database rules for text messages: trimmed, at least one visible
// character, at most MESSAGE_MAX_LENGTH code points.
export function checkTextMessage(text: string): TextMessageCheck {
  const content = text.trim()
  if (content === '') return { ok: false, error: 'chat.errors.messageEmpty' }
  if ([...content].length > MESSAGE_MAX_LENGTH) return { ok: false, error: 'chat.errors.messageTooLong' }
  return { ok: true, content }
}

// `id` lets the caller show the message before the server confirms it (optimistic UI).
// Sending again with the same id is safe: it never stores a second copy.
// sender_id and created_at always come from the database.
export async function sendTextMessage(
  conversationId: string,
  text: string,
  id: string = crypto.randomUUID(),
): Promise<ChatResult<Message>> {
  const checked = checkTextMessage(text)
  if (!checked.ok) return checked

  const response = await supabase
    .from('messages')
    .insert({ id, conversation_id: conversationId, kind: 'text', content: checked.content })
    .select(MESSAGE_COLUMNS)
    .single()
  if (!response.error) return { ok: true, data: toMessage(response.data) }
  // 23505: the id is already stored, e.g. a retry after the first reply was lost.
  if (response.error.code === '23505') {
    return fetchStoredMessage(id, conversationId, { kind: 'text', content: checked.content })
  }
  return fail(response, 'send')
}

type StoredMessageMatch =
  | { kind: 'text'; content: string }
  | { kind: 'image' | 'file'; attachmentPath: string }

// The stored copy of a message this client already sent. The id was generated here, so
// a row with the same id, conversation and content (or attachment) is that message.
async function fetchStoredMessage(
  id: string,
  conversationId: string,
  match: StoredMessageMatch,
): Promise<ChatResult<Message>> {
  const query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .eq('kind', match.kind)
  const response = await (match.kind === 'text'
    ? query.eq('content', match.content)
    : query.eq('attachment_path', match.attachmentPath)
  ).maybeSingle()
  if (response.error) return fail(response, 'send')
  if (!response.data) return { ok: false, error: 'chat.errors.sendFailed' }
  return { ok: true, data: toMessage(response.data) }
}

// Sends an image or file message for an attachment the caller has already uploaded. The
// database checks that the file exists, was uploaded by the caller and matches the
// declared type and size. Sending again with the same id never stores a second copy.
export async function insertAttachmentMessage(
  conversationId: string,
  kind: 'image' | 'file',
  attachment: Attachment,
  id: string,
): Promise<ChatResult<Message>> {
  const response = await supabase
    .from('messages')
    .insert({
      id,
      conversation_id: conversationId,
      kind,
      content: '',
      attachment_path: attachment.path,
      attachment_name: attachment.name,
      attachment_size: attachment.size,
      attachment_mime: attachment.mime,
    })
    .select(MESSAGE_COLUMNS)
    .single()
  if (!response.error) return { ok: true, data: toMessage(response.data) }
  if (response.error.code === '23505') {
    return fetchStoredMessage(id, conversationId, { kind, attachmentPath: attachment.path })
  }
  return fail(response, 'send')
}

// Moves the user's read marker forward to `readAt` (a message's created_at). The filter
// keeps it from moving back when another tab has already marked a newer message read.
export async function markConversationRead(
  conversationId: string,
  userId: string,
  readAt: string,
): Promise<ChatResult<null>> {
  const response = await supabase
    .from('conversation_members')
    .update({ last_read_at: readAt })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .or(`last_read_at.is.null,last_read_at.lt."${readAt}"`)
  if (response.error) return fail(response, 'load')
  return { ok: true, data: null }
}

// Same rule as the profiles_username_format check.
const USERNAME_QUERY = /^[a-z0-9_]{1,32}$/
export const PROFILE_SEARCH_LIMIT = 20

// The search text as a username prefix, or null when it cannot match any username.
export function normalizeUsernameQuery(text: string): string | null {
  const query = text.trim().toLowerCase().replace(/^@/, '')
  return USERNAME_QUERY.test(query) ? query : null
}

// What the search box can match: a username prefix, an exact phone number, or both (a
// username may be all digits, so a phone-shaped query also searches usernames).
export interface UserSearch {
  username: string | null
  // The stored form +84xxxxxxxxx.
  phone: string | null
}

// null when the text can match neither a username nor a phone number.
export function parseUserSearch(text: string): UserSearch | null {
  const username = normalizeUsernameQuery(text)
  const phone = normalizePhone(text)
  return username === null && phone === null ? null : { username, phone }
}

// The user with exactly this number (stored form), the caller excluded. The number itself
// is never returned.
export async function findProfileByPhone(phone: string): Promise<ChatResult<Profile[]>> {
  const response = await supabase.rpc('find_profile_by_phone', { p_phone: phone })
  if (response.error) return fail(response, 'phoneSearch')
  return {
    ok: true,
    data: response.data.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarPath: row.avatar_path,
    })),
  }
}

// Phone match first, then username matches, without duplicates.
export async function searchUsers(
  search: UserSearch,
  excludeUserId: string,
): Promise<ChatResult<Profile[]>> {
  const empty: ChatResult<Profile[]> = { ok: true, data: [] }
  const [byPhone, byUsername] = await Promise.all([
    search.phone === null ? empty : findProfileByPhone(search.phone),
    search.username === null ? empty : searchProfiles(search.username, excludeUserId),
  ])
  if (!byPhone.ok) return byPhone
  if (!byUsername.ok) return byUsername
  const seen = new Set(byPhone.data.map((profile) => profile.id))
  const rest = byUsername.data.filter((profile) => !seen.has(profile.id))
  return { ok: true, data: [...byPhone.data, ...rest].slice(0, PROFILE_SEARCH_LIMIT) }
}

// Users whose username starts with `query` (already normalized), the caller excluded.
export async function searchProfiles(
  query: string,
  excludeUserId: string,
): Promise<ChatResult<Profile[]>> {
  // "_" is a LIKE wildcard, so it is escaped; the other allowed characters are literal.
  const pattern = `${query.replace(/_/g, '\\_')}%`
  const response = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_path')
    .ilike('username', pattern)
    .neq('id', excludeUserId)
    .order('username')
    .limit(PROFILE_SEARCH_LIMIT)
  if (response.error) return fail(response, 'load')
  return {
    ok: true,
    data: response.data.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarPath: row.avatar_path,
    })),
  }
}

// Returns the existing direct chat with that user, or creates it.
export async function createDirectChat(otherUserId: string): Promise<ChatResult<string>> {
  const response = await supabase.rpc('create_direct_conversation', {
    p_other_user_id: otherUserId,
  })
  if (response.error) return fail(response, 'create')
  return { ok: true, data: response.data }
}

// Same limits as create_group_conversation and the conversations_shape check.
export const GROUP_TITLE_MAX_LENGTH = 100
// Including the creator.
export const GROUP_MAX_MEMBERS = 50

export type GroupCheckErrorKey =
  | 'chat.errors.groupTitleRequired'
  | 'chat.errors.groupTitleTooLong'
  | 'chat.errors.groupTitleInvalid'
  | 'chat.errors.groupNoMembers'
  | 'chat.errors.groupTooManyMembers'

export type GroupCheck = { ok: true; title: string } | { ok: false; error: GroupCheckErrorKey }

export type GroupTitleCheck =
  | { ok: true; title: string }
  | {
      ok: false
      error:
        | 'chat.errors.groupTitleRequired'
        | 'chat.errors.groupTitleTooLong'
        | 'chat.errors.groupTitleInvalid'
    }

// The title rules of create_group_conversation and rename_group: trimmed, 1 to
// GROUP_TITLE_MAX_LENGTH code points, no control characters.
export function checkGroupTitle(title: string): GroupTitleCheck {
  const trimmed = title.trim()
  if (trimmed === '') return { ok: false, error: 'chat.errors.groupTitleRequired' }
  if ([...trimmed].length > GROUP_TITLE_MAX_LENGTH) {
    return { ok: false, error: 'chat.errors.groupTitleTooLong' }
  }
  // eslint-disable-next-line no-control-regex -- control characters are what is rejected
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false, error: 'chat.errors.groupTitleInvalid' }
  return { ok: true, title: trimmed }
}

// `memberIds` are the OTHER members; the creator is added by the database.
export function checkGroupInput(title: string, memberIds: string[]): GroupCheck {
  const checked = checkGroupTitle(title)
  if (!checked.ok) return checked
  const trimmed = checked.title
  if (memberIds.length === 0) return { ok: false, error: 'chat.errors.groupNoMembers' }
  if (memberIds.length + 1 > GROUP_MAX_MEMBERS) {
    return { ok: false, error: 'chat.errors.groupTooManyMembers' }
  }
  return { ok: true, title: trimmed }
}

export async function createGroupChat(
  title: string,
  memberIds: string[],
): Promise<ChatResult<string>> {
  const uniqueIds = [...new Set(memberIds)]
  const checked = checkGroupInput(title, uniqueIds)
  if (!checked.ok) return checked

  const response = await supabase.rpc('create_group_conversation', {
    p_title: checked.title,
    p_member_ids: uniqueIds,
  })
  if (response.error) return fail(response, 'create')
  return { ok: true, data: response.data }
}

// Group management (migration 12). Each change is one RPC that locks the group, checks
// the caller's role and writes the matching system message. Every member may rename the
// group and add people; only the owner removes members or hands the group over. Repeating
// a change that already happened (same title, someone already added or already removed)
// changes nothing, so retrying after a lost answer is safe.

// Returns the stored (trimmed) title.
export async function renameGroup(
  conversationId: string,
  title: string,
): Promise<ChatResult<string>> {
  const checked = checkGroupTitle(title)
  if (!checked.ok) return checked
  const response = await supabase.rpc('rename_group', {
    p_conversation_id: conversationId,
    p_title: checked.title,
  })
  if (response.error) return fail(response, 'group')
  return { ok: true, data: checked.title }
}

// `userIds` are the users to add; those already in the group are skipped. The group may
// then have GROUP_MAX_MEMBERS members at most, or nobody is added (chat.errors.groupFull).
// Returns how many were added.
export async function addGroupMembers(
  conversationId: string,
  userIds: string[],
): Promise<ChatResult<number>> {
  const uniqueIds = [...new Set(userIds)]
  if (uniqueIds.length === 0) return { ok: false, error: 'chat.errors.groupNoMembers' }
  if (uniqueIds.length > GROUP_MAX_MEMBERS - 1) return { ok: false, error: 'chat.errors.groupFull' }
  const response = await supabase.rpc('add_group_members', {
    p_conversation_id: conversationId,
    p_user_ids: uniqueIds,
  })
  if (response.error) return fail(response, 'group')
  return { ok: true, data: response.data }
}

// Owner only. The removed member loses access at once and is told through Realtime.
export async function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<ChatResult<null>> {
  const response = await supabase.rpc('remove_group_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  })
  if (response.error) return fail(response, 'group')
  return { ok: true, data: null }
}

// Owner only: `userId` (a member) becomes the owner and the caller a plain member.
export async function transferGroupOwnership(
  conversationId: string,
  userId: string,
): Promise<ChatResult<null>> {
  const response = await supabase.rpc('transfer_group_ownership', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  })
  if (response.error) return fail(response, 'group')
  return { ok: true, data: null }
}

// When the owner leaves, the member who joined first becomes the owner. When the last
// member leaves, the group and its messages are deleted. A member who has already left
// (e.g. in another tab) gets chat.errors.groupGone.
export async function leaveGroup(conversationId: string): Promise<ChatResult<null>> {
  const response = await supabase.rpc('leave_group', { p_conversation_id: conversationId })
  if (response.error) return fail(response, 'group')
  return { ok: true, data: null }
}

// How long after sending the sender may edit or recall a message. The database enforces
// it with its own clock; the app only uses it to hide the actions.
export const MESSAGE_CHANGE_WINDOW_MS = 2 * 60 * 1000

// RLS hides rows the caller may not change, so an update that matches none returns no row.
async function changeMessage(
  id: string,
  change: Database['public']['Tables']['messages']['Update'],
): Promise<ChatResult<Message>> {
  const response = await supabase
    .from('messages')
    .update(change)
    .eq('id', id)
    .select(MESSAGE_COLUMNS)
    .maybeSingle()
  if (response.error) return fail(response, 'change')
  if (!response.data) return { ok: false, error: 'chat.errors.notAllowed' }
  return { ok: true, data: toMessage(response.data) }
}

// Replaces the text of the caller's own text message. The database records when.
export async function editMessage(id: string, text: string): Promise<ChatResult<Message>> {
  const checked = checkTextMessage(text)
  if (!checked.ok) return checked
  return changeMessage(id, { content: checked.content })
}

// Recalls the caller's own message for everyone. The database uses its own time and
// clears the content and attachment. Recalling again changes nothing.
export async function recallMessage(id: string): Promise<ChatResult<Message>> {
  return changeMessage(id, { deleted_at: new Date().toISOString() })
}

// At most this many messages can be selected, hidden or recalled at once. It also keeps
// the `id=in.(...)` request URL well under server limits.
export const MESSAGE_SELECT_LIMIT = 100

// Hides messages from the caller only ("delete for me"); other members still see them.
// One statement, so either every message is hidden or none is. Hiding a message again
// changes nothing, so retrying after a lost answer is safe.
export async function hideMessages(ids: string[]): Promise<ChatResult<null>> {
  if (ids.length === 0 || ids.length > MESSAGE_SELECT_LIMIT) {
    return { ok: false, error: 'chat.errors.deleteFailed' }
  }
  const response = await supabase
    .from('message_hides')
    .upsert(
      ids.map((id) => ({ message_id: id })),
      { onConflict: 'user_id,message_id', ignoreDuplicates: true },
    )
  if (response.error) return fail(response, 'delete')
  return { ok: true, data: null }
}

// Deletes a conversation's history for the caller only: messages sent up to now are hidden
// from them, other members keep everything. Returns the new mark (server time). Clearing
// again only moves the mark forward, so retrying after a lost answer is safe.
export async function clearConversation(conversationId: string): Promise<ChatResult<string>> {
  const response = await supabase.rpc('clear_conversation', {
    p_conversation_id: conversationId,
  })
  if (response.error) {
    const failed = fail(response, 'delete')
    return failed.error === 'chat.errors.deleteFailed'
      ? { ok: false, error: 'chat.errors.deleteConversationFailed' }
      : failed
  }
  return { ok: true, data: response.data }
}

// Recalls several of the caller's own messages for everyone in one statement: when one of
// them is too old, the database refuses them all (CS001). RLS skips messages the caller
// may not change, so the answer lists the messages that are now recalled.
export async function recallMessages(ids: string[]): Promise<ChatResult<Message[]>> {
  if (ids.length === 0 || ids.length > MESSAGE_SELECT_LIMIT) {
    return { ok: false, error: 'chat.errors.changeFailed' }
  }
  const response = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ids)
    .select(MESSAGE_COLUMNS)
  if (response.error) return fail(response, 'change')
  return { ok: true, data: response.data.map(toMessage) }
}

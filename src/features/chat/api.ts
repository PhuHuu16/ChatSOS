// Reads and writes for the chat screens. Every request runs as the signed-in user, so RLS
// already limits rows to conversations the user belongs to; nothing here filters by user id.
import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'
import { toChatErrorKey, type ChatAction, type ChatErrorKey } from './chatErrors'
import type { Conversation, Message, Profile, User } from './types'

type MessageRow = Pick<
  Database['public']['Tables']['messages']['Row'],
  'id' | 'conversation_id' | 'sender_id' | 'kind' | 'content' | 'created_at'
>

// Same limit as the messages_content_length check (char_length counts code points).
export const MESSAGE_MAX_LENGTH = 4000
export const MESSAGE_PAGE_SIZE = 50
// Keeps each `id=in.(...)` request URL well under server limits.
const PROFILE_BATCH_SIZE = 100

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, kind, content, created_at'

export type ChatResult<T> = { ok: true; data: T } | { ok: false; error: ChatErrorKey }

export interface ConversationList {
  // Newest activity first: last message time, or creation time when there is none yet.
  conversations: Conversation[]
  // Every member of the listed conversations, including the current user.
  users: User[]
  // The newest message of each conversation that has one.
  lastMessages: Message[]
}

interface FailedResponse {
  status: number
  error: { code?: string } | null
}

function fail(response: FailedResponse, action: ChatAction): { ok: false; error: ChatErrorKey } {
  return { ok: false, error: toChatErrorKey(response.status, response.error?.code, action) }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at,
  }
}

const MESSAGE_KINDS: ReadonlySet<string> = new Set<MessageRow['kind']>(['text', 'image', 'file'])

function isMessageKind(kind: string): kind is MessageRow['kind'] {
  return MESSAGE_KINDS.has(kind)
}

// The new row of a Realtime INSERT event on messages, or null when the event carries no
// usable row (e.g. an error event, which has no record).
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
  return toMessage({ id, conversation_id, sender_id, kind, content, created_at })
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export async function fetchConversationList(): Promise<ChatResult<ConversationList>> {
  const conversationsResponse = await supabase
    .from('conversations')
    .select('id, type, title, created_at, last_message_at')
  if (conversationsResponse.error) return fail(conversationsResponse, 'load')
  const rows = conversationsResponse.data
  if (rows.length === 0) return { ok: true, data: { conversations: [], users: [], lastMessages: [] } }

  // RLS returns the members of the caller's conversations only.
  const membersResponse = await supabase.from('conversation_members').select('conversation_id, user_id')
  if (membersResponse.error) return fail(membersResponse, 'load')

  const memberIdsByConversation = new Map<string, string[]>()
  for (const member of membersResponse.data) {
    const ids = memberIdsByConversation.get(member.conversation_id) ?? []
    ids.push(member.user_id)
    memberIdsByConversation.set(member.conversation_id, ids)
  }

  const userIds = [...new Set(membersResponse.data.map((member) => member.user_id))]
  const profileResponses = await Promise.all(
    chunk(userIds, PROFILE_BATCH_SIZE).map((ids) =>
      supabase.from('profiles').select('id, display_name').in('id', ids),
    ),
  )
  const users: User[] = []
  for (const response of profileResponses) {
    if (response.error) return fail(response, 'load')
    for (const profile of response.data) {
      users.push({ id: profile.id, displayName: profile.display_name })
    }
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

  const activity = (row: (typeof rows)[number]) => Date.parse(row.last_message_at ?? row.created_at)
  const conversations: Conversation[] = [...rows]
    .sort((a, b) => activity(b) - activity(a))
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      memberIds: memberIdsByConversation.get(row.id) ?? [],
      lastActivityAt: row.last_message_at ?? row.created_at,
    }))

  return { ok: true, data: { conversations, users, lastMessages } }
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
    return fetchStoredTextMessage(id, conversationId, checked.content)
  }
  return fail(response, 'send')
}

// The stored copy of a message this client already sent. The id was generated here, so
// a row with the same id, conversation and text is that message.
async function fetchStoredTextMessage(
  id: string,
  conversationId: string,
  content: string,
): Promise<ChatResult<Message>> {
  const response = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .eq('kind', 'text')
    .eq('content', content)
    .maybeSingle()
  if (response.error) return fail(response, 'send')
  if (!response.data) return { ok: false, error: 'chat.errors.sendFailed' }
  return { ok: true, data: toMessage(response.data) }
}

// Same rule as the profiles_username_format check.
const USERNAME_QUERY = /^[a-z0-9_]{1,32}$/
export const PROFILE_SEARCH_LIMIT = 20

// The search text as a username prefix, or null when it cannot match any username.
export function normalizeUsernameQuery(text: string): string | null {
  const query = text.trim().toLowerCase().replace(/^@/, '')
  return USERNAME_QUERY.test(query) ? query : null
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
    .select('id, username, display_name')
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

// `memberIds` are the OTHER members; the creator is added by the database.
export function checkGroupInput(title: string, memberIds: string[]): GroupCheck {
  const trimmed = title.trim()
  if (trimmed === '') return { ok: false, error: 'chat.errors.groupTitleRequired' }
  if ([...trimmed].length > GROUP_TITLE_MAX_LENGTH) {
    return { ok: false, error: 'chat.errors.groupTitleTooLong' }
  }
  // eslint-disable-next-line no-control-regex -- control characters are what is rejected
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false, error: 'chat.errors.groupTitleInvalid' }
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

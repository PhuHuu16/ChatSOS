// Reads and writes for the chat screens. Every request runs as the signed-in user, so RLS
// already limits rows to conversations the user belongs to; nothing here filters by user id.
import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'
import { toChatErrorKey, type ChatAction, type ChatErrorKey } from './chatErrors'
import type { Conversation, Message, User } from './types'

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
  if (response.error) return fail(response, 'send')
  return { ok: true, data: toMessage(response.data) }
}

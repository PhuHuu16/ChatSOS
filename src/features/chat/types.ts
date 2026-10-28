export type ConversationType = 'direct' | 'group'
export type MessageKind = 'text' | 'image' | 'file'

export interface User {
  id: string
  displayName: string
}

// A user found by username search, e.g. when starting a chat.
export interface Profile extends User {
  username: string
}

export interface Conversation {
  id: string
  type: ConversationType
  // Only groups have a title; direct chats are named after the other member.
  title: string | null
  memberIds: string[]
  // ISO 8601: the last message time, or the creation time when there is none yet.
  lastActivityAt: string
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  kind: MessageKind
  content: string
  // ISO 8601
  createdAt: string
}

export type ConversationType = 'direct' | 'group'
export type MessageKind = 'text' | 'image' | 'file'

export interface User {
  id: string
  displayName: string
}

export interface Conversation {
  id: string
  type: ConversationType
  // Only groups have a title; direct chats are named after the other member.
  title: string | null
  memberIds: string[]
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

export type ConversationType = 'direct' | 'group'
export type MessageKind = 'text' | 'image' | 'file' | 'system'

export type SystemEvent =
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'title_changed'
  | 'owner_changed'

export interface SystemInfo {
  event: SystemEvent
  targetId: string | null
}

export interface User {
  id: string
  displayName: string
  avatarPath: string | null
}

export interface Profile extends User {
  username: string
}

export interface Conversation {
  id: string
  type: ConversationType
  title: string | null
  memberIds: string[]
  ownerId: string | null
  lastActivityAt: string
  lastReadAt: string | null
  memberReadAt: Readonly<Record<string, string | null>>
  clearedAt: string | null
}

export interface Removal {
  conversationId: string
  removedAt: string
}

export interface MemberRead {
  conversationId: string
  userId: string
  lastReadAt: string | null
}

export interface UnreadMessage {
  id: string
  conversationId: string
  createdAt: string
}

export interface Attachment {
  path: string
  name: string
  size: number
  mime: string
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  kind: MessageKind
  content: string
  attachment: Attachment | null
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  system?: SystemInfo
}

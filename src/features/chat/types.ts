export type ConversationType = 'direct' | 'group'
export type MessageKind = 'text' | 'image' | 'file'

export interface User {
  id: string
  displayName: string
  // "<user id>/<uuid>.jpg" in the private avatars bucket, or null when there is none.
  avatarPath: string | null
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
  // ISO 8601: the current user's read marker; messages after it are unread. null = none read.
  lastReadAt: string | null
  // Every member's read marker when the list loaded, by user id (null = none read).
  memberReadAt: Readonly<Record<string, string | null>>
}

// A member's read marker, as Realtime reports it.
export interface MemberRead {
  conversationId: string
  userId: string
  // ISO 8601, or null when the member has read nothing.
  lastReadAt: string | null
}

// A message from someone else that the current user has not read yet.
export interface UnreadMessage {
  id: string
  conversationId: string
  createdAt: string
}

// A file stored in the private attachments bucket.
export interface Attachment {
  // "<conversation id>/<uuid>.<extension>" inside the bucket.
  path: string
  // The original file name, for display and downloads only.
  name: string
  // Bytes.
  size: number
  mime: string
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  kind: MessageKind
  // Empty for image and file messages, and once recalled.
  content: string
  // Set exactly for image and file messages that were not recalled.
  attachment: Attachment | null
  // ISO 8601
  createdAt: string
  // ISO 8601, when the text was last edited; null if never.
  editedAt: string | null
  // ISO 8601, when the sender recalled the message; null if not recalled.
  deletedAt: string | null
}

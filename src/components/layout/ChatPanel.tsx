import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CheckedFile } from '../../features/chat/attachments'
import type { ChatErrorKey } from '../../features/chat/chatErrors'
import {
  findUser,
  getConversationAvatarPath,
  getConversationTitle,
} from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { PendingMessage } from '../../features/chat/useOutgoingMessages'
import { useTyping } from '../../features/chat/useTyping'
import { Avatar } from '../Avatar'
import { Composer } from '../Composer'
import { MessageList } from './MessageList'

interface ChatPanelProps {
  conversation: Conversation | null
  // The newest page of `conversation`'s messages, oldest first.
  messages: ChatQueryState<Message[]>
  // Messages sent or received since the chat screen opened, of every conversation.
  live: Message[]
  pending: PendingMessage[]
  users: User[]
  currentUserId: string
  onBack: () => void
  onSend: (conversationId: string, content: string) => void
  onSendFile: (conversationId: string, file: Blob, checked: CheckedFile) => void
  onRetry: (message: PendingMessage) => void
  onDiscard: (message: PendingMessage) => void
  // The newest copy of each message edited or recalled since the chat screen opened.
  updates: ReadonlyMap<string, Message>
  // Resolve to null on success, or the error to show.
  onEdit: (message: Message, content: string) => Promise<ChatErrorKey | null>
  onRecall: (message: Message) => Promise<ChatErrorKey | null>
  // Unread messages in `conversation`.
  unreadCount: number
  // The user's read marker for `conversation` (ISO 8601), or null when none is read.
  readMarker: string | null
  // The user has seen the conversation up to the message created at `readAt`.
  onRead: (conversationId: string, readAt: string) => void
  // The other members' read markers in `conversation`, by user id.
  othersRead: ReadonlyMap<string, string | null>
}

export function ChatPanel({
  conversation,
  messages,
  live,
  pending,
  users,
  currentUserId,
  onBack,
  onSend,
  onSendFile,
  onRetry,
  onDiscard,
  unreadCount,
  readMarker,
  onRead,
  othersRead,
  updates,
  onEdit,
  onRecall,
}: ChatPanelProps) {
  const { t } = useTranslation()
  const typing = useTyping(conversation?.id ?? null, currentUserId, conversation?.memberIds ?? [])
  const typingNames = typing.typingUserIds
    .map((id) => findUser(users, id)?.displayName)
    .filter((name): name is string => Boolean(name))
  // The message being edited in the composer.
  const [editing, setEditing] = useState<Message | null>(null)
  // The message whose edit or recall is waiting for the server.
  const [changingId, setChangingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{
    conversationId: string
    error: ChatErrorKey
  } | null>(null)
  // Both belong to one conversation and are dropped when another one is opened.
  const editingHere = editing && editing.conversationId === conversation?.id ? editing : null
  const errorHere =
    actionError && actionError.conversationId === conversation?.id ? actionError.error : null

  function startEdit(message: Message) {
    setActionError(null)
    setEditing(message)
  }

  async function saveEdit(message: Message, content: string) {
    // Nothing changed: nothing to save.
    if (content === message.content) {
      setEditing(null)
      return
    }
    setActionError(null)
    setChangingId(message.id)
    const error = await onEdit(message, content)
    setChangingId(null)
    if (error) setActionError({ conversationId: message.conversationId, error })
    else setEditing(null)
  }

  async function recall(message: Message) {
    if (!window.confirm(t('chat.recallConfirm'))) return
    setActionError(null)
    setChangingId(message.id)
    const error = await onRecall(message)
    setChangingId(null)
    if (error) {
      setActionError({ conversationId: message.conversationId, error })
    } else if (editing?.id === message.id) {
      setEditing(null)
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-50 p-6">
        <p className="rounded-full bg-white px-4 py-2 text-sm text-slate-500 shadow-sm">
          {t('chat.emptyState')}
        </p>
      </div>
    )
  }

  const title = getConversationTitle(conversation, users, currentUserId)

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('chat.back')}
          className="-ml-1 rounded-full px-2 py-1 text-xl leading-none text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:hidden"
        >
          <span aria-hidden="true">←</span>
        </button>
        <Avatar
          id={conversation.id}
          name={title}
          avatarPath={getConversationAvatarPath(conversation, users, currentUserId)}
        />
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="text-sm text-slate-500">
            {conversation.type === 'group'
              ? t('chat.members', { count: conversation.memberIds.length })
              : t('chat.direct')}
          </p>
        </div>
      </header>

      <MessageList
        key={`messages:${conversation.id}`}
        conversation={conversation}
        latest={messages}
        live={live}
        pending={pending}
        users={users}
        currentUserId={currentUserId}
        unreadCount={unreadCount}
        readMarker={readMarker}
        othersRead={othersRead}
        typingNames={typingNames}
        updates={updates}
        editingId={editingHere?.id ?? null}
        changingId={changingId}
        onStartEdit={startEdit}
        onRecall={(message) => void recall(message)}
        onRetry={onRetry}
        onDiscard={onDiscard}
        onRead={onRead}
      />

      {errorHere && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <p>{t(errorHere)}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={t('chat.dismiss')}
            className="rounded px-1 text-lg leading-none hover:text-red-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      <Composer
        key={`composer:${conversation.id}:${editingHere?.id ?? ''}`}
        onSend={(content) => onSend(conversation.id, content)}
        onSendFile={(file, checked) => onSendFile(conversation.id, file, checked)}
        onTyping={typing.setTyping}
        editing={
          editingHere && {
            content: editingHere.content,
            saving: changingId === editingHere.id,
            onSave: (content) => void saveEdit(editingHere, content),
            onCancel: () => setEditing(null),
          }
        }
      />
    </div>
  )
}

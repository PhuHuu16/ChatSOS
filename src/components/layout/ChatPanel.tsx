import { useTranslation } from 'react-i18next'
import type { CheckedFile } from '../../features/chat/attachments'
import { getConversationTitle } from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { PendingMessage } from '../../features/chat/useOutgoingMessages'
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
  onDiscard: (id: string) => void
  // Unread messages in `conversation`.
  unreadCount: number
  // The user's read marker for `conversation` (ISO 8601), or null when none is read.
  readMarker: string | null
  // The user has seen the conversation up to the message created at `readAt`.
  onRead: (conversationId: string, readAt: string) => void
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
}: ChatPanelProps) {
  const { t } = useTranslation()

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
        <Avatar id={conversation.id} name={title} />
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
        onRetry={onRetry}
        onDiscard={onDiscard}
        onRead={onRead}
      />

      <Composer
        key={`composer:${conversation.id}`}
        onSend={(content) => onSend(conversation.id, content)}
        onSendFile={(file, checked) => onSendFile(conversation.id, file, checked)}
      />
    </div>
  )
}

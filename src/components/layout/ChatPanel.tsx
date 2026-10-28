import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { MESSAGE_PAGE_SIZE } from '../../features/chat/api'
import {
  findUser,
  formatTime,
  getConversationTitle,
  withLiveMessages,
} from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { PendingMessage } from '../../features/chat/useOutgoingMessages'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { Avatar } from '../Avatar'
import { Composer } from '../Composer'
import { LoadStatus } from '../LoadStatus'

interface ChatPanelProps {
  conversation: Conversation | null
  // Messages of `conversation`, oldest first.
  messages: ChatQueryState<Message[]>
  // Messages sent or received since the chat screen opened, of every conversation.
  live: Message[]
  pending: PendingMessage[]
  users: User[]
  currentUserId: string
  onBack: () => void
  onSend: (conversationId: string, content: string) => void
  onRetry: (message: PendingMessage) => void
  onDiscard: (id: string) => void
}

const BUBBLE_CLASS = 'max-w-[75%] rounded-2xl px-3 py-2'
const MINE_CLASS = 'rounded-br-sm bg-brand-100'
// Within this distance (px) of the bottom, new messages keep the list scrolled down.
const STICK_DISTANCE = 80
const SMALL_BUTTON_CLASS =
  'rounded px-1 font-medium underline hover:text-red-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500'

export function ChatPanel({
  conversation,
  messages,
  live,
  pending,
  users,
  currentUserId,
  onBack,
  onSend,
  onRetry,
  onDiscard,
}: ChatPanelProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  const listRef = useRef<HTMLDivElement>(null)
  // Whether the list is at (or near) the bottom, so new messages should keep it there.
  const stickRef = useRef(true)
  const loaded = messages.status === 'ready' ? messages.data : null
  const isLoaded = loaded !== null
  const conversationId = conversation?.id ?? null
  const shown = conversationId
    ? withLiveMessages(loaded ?? [], live, conversationId, MESSAGE_PAGE_SIZE)
    : []
  // Realtime can deliver the user's own message before the send request returns.
  const shownIds = new Set(shown.map((message) => message.id))
  const pendingHere = pending.filter(
    (message) => message.conversationId === conversationId && !shownIds.has(message.id),
  )
  const shownCount = shown.length + pendingHere.length
  // Changes when a pending message fails or is retried, which changes its height.
  const pendingStatuses = pendingHere.map((message) => message.status).join()

  // Opening a conversation shows its newest messages.
  useEffect(() => {
    stickRef.current = true
  }, [conversationId, isLoaded])

  // Keeps the newest message in view as messages are added or change, unless the user
  // has scrolled up to read older ones.
  useEffect(() => {
    const list = listRef.current
    if (list && stickRef.current) list.scrollTop = list.scrollHeight
  }, [conversationId, isLoaded, shownCount, pendingStatuses])

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
  const isGroup = conversation.type === 'group'

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
            {isGroup
              ? t('chat.members', { count: conversation.memberIds.length })
              : t('chat.direct')}
          </p>
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget
          stickRef.current =
            list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_DISTANCE
        }}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.status === 'loading' && <LoadStatus status="loading" />}
        {messages.status === 'error' && (
          <LoadStatus status="error" error={messages.error} onRetry={messages.reload} />
        )}
        {loaded && shownCount === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">{t('chat.noMessages')}</p>
        )}
        <ol className="flex flex-col gap-2">
          {shown.map((message) => {
            const isMine = message.senderId === currentUserId
            const senderName =
              isGroup && !isMine ? findUser(users, message.senderId)?.displayName : undefined

            return (
              <li key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`${BUBBLE_CLASS} ${isMine ? MINE_CLASS : 'rounded-bl-sm bg-slate-100'}`}>
                  {senderName && (
                    <p className="mb-0.5 text-xs font-semibold text-brand-700">{senderName}</p>
                  )}
                  <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                  <time
                    dateTime={message.createdAt}
                    className="mt-0.5 block text-right text-xs text-slate-500"
                  >
                    {formatTime(message.createdAt, language)}
                  </time>
                </div>
              </li>
            )
          })}
          {pendingHere.map((message) => (
            <li key={message.id} className="flex justify-end">
              <div
                className={`${BUBBLE_CLASS} ${MINE_CLASS} ${
                  message.status === 'failed' ? 'ring-1 ring-red-300' : 'opacity-70'
                }`}
              >
                <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                {message.status === 'sending' ? (
                  <p role="status" className="mt-0.5 text-right text-xs text-slate-500">
                    {t('chat.sending')}
                  </p>
                ) : (
                  <div role="alert" className="mt-1 text-right text-xs text-red-700">
                    <p>{t(message.error ?? 'chat.errors.sendFailed')}</p>
                    <div className="mt-0.5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onRetry(message)}
                        className={SMALL_BUTTON_CLASS}
                      >
                        {t('chat.retry')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDiscard(message.id)}
                        className={SMALL_BUTTON_CLASS}
                      >
                        {t('chat.discard')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Composer
        key={conversation.id}
        onSend={(content) => {
          // The user's own message always scrolls into view.
          stickRef.current = true
          onSend(conversation.id, content)
        }}
      />
    </div>
  )
}

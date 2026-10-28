import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { findUser, formatTime, getConversationTitle } from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { Avatar } from '../Avatar'
import { LoadStatus } from '../LoadStatus'

interface ChatPanelProps {
  conversation: Conversation | null
  // Messages of `conversation`, oldest first.
  messages: ChatQueryState<Message[]>
  users: User[]
  currentUserId: string
  onBack: () => void
}

export function ChatPanel({ conversation, messages, users, currentUserId, onBack }: ChatPanelProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  const listRef = useRef<HTMLDivElement>(null)
  const loaded = messages.status === 'ready' ? messages.data : null

  // Jump to the newest message whenever a conversation's messages have loaded.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [loaded])

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

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.status === 'loading' && <LoadStatus status="loading" />}
        {messages.status === 'error' && (
          <LoadStatus status="error" error={messages.error} onRetry={messages.reload} />
        )}
        {loaded?.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">{t('chat.noMessages')}</p>
        )}
        <ol className="flex flex-col gap-2">
          {(loaded ?? []).map((message) => {
            const isMine = message.senderId === currentUserId
            const senderName =
              isGroup && !isMine ? findUser(users, message.senderId)?.displayName : undefined

            return (
              <li key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    isMine ? 'rounded-br-sm bg-brand-100' : 'rounded-bl-sm bg-slate-100'
                  }`}
                >
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
        </ol>
      </div>

      <form
        onSubmit={(event) => event.preventDefault()}
        className="border-t border-slate-200 px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            disabled
            placeholder={t('chat.composerPlaceholder')}
            aria-label={t('chat.composerPlaceholder')}
            className="min-w-0 flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('chat.send')}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">{t('chat.previewNotice')}</p>
      </form>
    </div>
  )
}

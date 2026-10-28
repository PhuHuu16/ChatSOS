import { useTranslation } from 'react-i18next'
import {
  findUser,
  formatTime,
  getConversationTitle,
  getLastMessage,
} from '../../features/chat/helpers'
import { UNREAD_LIMIT } from '../../features/chat/api'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { Avatar } from '../Avatar'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { LoadStatus } from '../LoadStatus'

interface SidebarProps {
  // Load state of the list; the data itself comes in the props below.
  list: ChatQueryState<unknown>
  conversations: Conversation[]
  // The newest message of each conversation that has one.
  lastMessages: Message[]
  // Unread message count by conversation id; missing = none.
  unreadCounts: ReadonlyMap<string, number>
  users: User[]
  currentUserId: string
  selectedId: string | null
  onSelect: (conversationId: string) => void
  onNewChat: () => void
  onNewGroup: () => void
  onSignOut: () => void
  signingOut: boolean
  signOutFailed: boolean
}

const NEW_BUTTON_CLASS =
  'flex-1 rounded-md border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500'

export function Sidebar({
  list,
  conversations,
  lastMessages,
  unreadCounts,
  users,
  currentUserId,
  selectedId,
  onSelect,
  onNewChat,
  onNewGroup,
  onSignOut,
  signingOut,
  signOutFailed,
}: SidebarProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h1 className="min-w-0 truncate text-lg font-semibold text-brand-700">{t('app.name')}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm whitespace-nowrap hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? t('auth.loggingOut') : t('auth.logout')}
          </button>
        </div>
      </header>

      {signOutFailed && (
        <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {t('auth.errors.signOutFailed')}
        </p>
      )}

      <div className="flex gap-2 border-b border-slate-200 px-4 py-2">
        <button type="button" onClick={onNewChat} className={NEW_BUTTON_CLASS}>
          {t('chat.newChat')}
        </button>
        <button type="button" onClick={onNewGroup} className={NEW_BUTTON_CLASS}>
          {t('chat.newGroup')}
        </button>
      </div>

      <nav aria-label={t('chat.listLabel')} className="flex-1 overflow-y-auto">
        {list.status === 'loading' && <LoadStatus status="loading" />}
        {list.status === 'error' && (
          <LoadStatus status="error" error={list.error} onRetry={list.reload} />
        )}
        {list.status === 'ready' && conversations.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-500">{t('chat.noConversations')}</p>
        )}
        <ul>
          {conversations.map((conversation) => {
            const title = getConversationTitle(conversation, users, currentUserId)
            const last = getLastMessage(lastMessages, conversation.id)
            const isSelected = conversation.id === selectedId
            const unread = unreadCounts.get(conversation.id) ?? 0

            let prefix = ''
            if (last?.senderId === currentUserId) {
              prefix = `${t('chat.you')}: `
            } else if (last && conversation.type === 'group') {
              const sender = findUser(users, last.senderId)
              if (sender) prefix = `${sender.displayName}: `
            }

            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 ${
                    isSelected ? 'bg-brand-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <Avatar id={conversation.id} name={title} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${unread > 0 ? 'font-semibold' : 'font-medium'}`}>
                        {title}
                      </span>
                      {last && (
                        <time
                          dateTime={last.createdAt}
                          className="shrink-0 text-xs text-slate-500"
                        >
                          {formatTime(last.createdAt, language)}
                        </time>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      {last && (
                        <span className="min-w-0 truncate text-sm text-slate-500">
                          {prefix}
                          {last.content}
                        </span>
                      )}
                      {unread > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-xs leading-none font-semibold text-white">
                          <span aria-hidden="true">
                            {unread >= UNREAD_LIMIT ? `${UNREAD_LIMIT - 1}+` : unread}
                          </span>
                          <span className="sr-only">{t('chat.unread', { count: unread })}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

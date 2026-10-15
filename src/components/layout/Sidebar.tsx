import { useTranslation } from 'react-i18next'
import {
  findUser,
  formatTime,
  getConversationTitle,
  getLastMessage,
} from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { Avatar } from '../Avatar'
import { LanguageSwitcher } from '../LanguageSwitcher'

interface SidebarProps {
  conversations: Conversation[]
  messages: Message[]
  users: User[]
  currentUserId: string
  selectedId: string | null
  onSelect: (conversationId: string) => void
}

export function Sidebar({
  conversations,
  messages,
  users,
  currentUserId,
  selectedId,
  onSelect,
}: SidebarProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h1 className="text-lg font-semibold text-brand-700">{t('app.name')}</h1>
        <LanguageSwitcher />
      </header>

      <nav aria-label={t('chat.listLabel')} className="flex-1 overflow-y-auto">
        <ul>
          {conversations.map((conversation) => {
            const title = getConversationTitle(conversation, users, currentUserId)
            const last = getLastMessage(messages, conversation.id)
            const isSelected = conversation.id === selectedId

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
                      <span className="truncate font-medium">{title}</span>
                      {last && (
                        <time
                          dateTime={last.createdAt}
                          className="shrink-0 text-xs text-slate-500"
                        >
                          {formatTime(last.createdAt, language)}
                        </time>
                      )}
                    </span>
                    {last && (
                      <span className="block truncate text-sm text-slate-500">
                        {prefix}
                        {last.content}
                      </span>
                    )}
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

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  findUser,
  formatTime,
  getConversationAvatarPath,
  getConversationTitle,
  getLastMessage,
} from '../../features/chat/helpers'
import { UNREAD_LIMIT } from '../../features/chat/api'
import { systemMessageText } from '../../features/chat/systemText'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { OwnProfile } from '../../features/profile/profileApi'
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
  // Asks to delete a conversation's history for the user (opens the confirmation).
  onDeleteConversation: (conversation: Conversation) => void
  onNewChat: () => void
  onNewGroup: () => void
  onSignOut: () => void
  signingOut: boolean
  signOutFailed: boolean
  // The signed-in user's profile; null while it loads or when it failed to load.
  profile: OwnProfile | null
  profileFailed: boolean
  onRetryProfile: () => void
  onOpenProfile: () => void
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
  onDeleteConversation,
  onNewChat,
  onNewGroup,
  onSignOut,
  signingOut,
  signOutFailed,
  profile,
  profileFailed,
  onRetryProfile,
  onOpenProfile,
}: SidebarProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  // The conversation whose ⋯ menu is open.
  const [menuFor, setMenuFor] = useState<string | null>(null)

  // An open menu closes on a click outside it or on Escape.
  useEffect(() => {
    if (menuFor === null) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-conversation-menu]')) return
      setMenuFor(null)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuFor(null)
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuFor])

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

      <div className="border-b border-slate-200 px-2 py-2">
        {profile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-haspopup="dialog"
            title={t('profile.open')}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <Avatar id={profile.id} name={profile.displayName} avatarPath={profile.avatarPath} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{profile.displayName}</span>
              <span className="block truncate text-xs text-slate-500">@{profile.username}</span>
            </span>
            <span className="sr-only">{t('profile.open')}</span>
          </button>
        ) : profileFailed ? (
          <p role="alert" className="flex items-center justify-between gap-2 px-2 py-1 text-sm text-red-700">
            {t('profile.loadFailed')}
            <button
              type="button"
              onClick={onRetryProfile}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              {t('chat.retry')}
            </button>
          </p>
        ) : (
          <p className="px-2 py-1 text-sm text-slate-500">{t('chat.loading')}</p>
        )}
      </div>

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
            const menuOpen = menuFor === conversation.id
            const menuId = `conversation-menu-${conversation.id}`

            // A system line ("You added B") already names who did it, so it gets none.
            let prefix = ''
            if (last?.system) {
              // No prefix.
            } else if (last?.senderId === currentUserId) {
              prefix = `${t('chat.you')}: `
            } else if (last && conversation.type === 'group') {
              const sender = findUser(users, last.senderId)
              if (sender) prefix = `${sender.displayName}: `
            }

            return (
              // An open menu's row is raised above the rows after it, which would cover the menu.
              <li key={conversation.id} className={`group relative ${menuOpen ? 'z-10' : ''}`}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  // On small screens the ⋯ button always shows, so the row leaves room for it.
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 ${
                    isSelected ? 'bg-brand-50' : 'hover:bg-slate-50'
                  } pr-12 md:pr-4`}
                >
                  <Avatar
                    id={conversation.id}
                    name={title}
                    avatarPath={getConversationAvatarPath(conversation, users, currentUserId)}
                  />
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
                          {last.system
                            ? systemMessageText(t, last, users, currentUserId)
                            : last.deletedAt !== null
                              ? t('chat.recalled')
                              : last.kind === 'image'
                                ? `📷 ${t('chat.photo')}`
                                : last.kind === 'file'
                                  ? `📎 ${last.attachment?.name ?? ''}`
                                  : last.content}
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
                {/* A separate button next to the row (a button cannot hold another one). On
                    larger screens it shows on hover or focus, over the time and badge. */}
                <div data-conversation-menu className="absolute top-1/2 right-2 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={() => setMenuFor(menuOpen ? null : conversation.id)}
                    aria-label={t('chat.conversationActions', { name: title })}
                    aria-expanded={menuOpen}
                    aria-controls={menuOpen ? menuId : undefined}
                    className={`rounded-full bg-white/90 px-2 py-0.5 text-base leading-none text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 ${
                      menuOpen
                        ? ''
                        : 'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
                    }`}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  {menuOpen && (
                    <div
                      id={menuId}
                      className="absolute top-full right-0 z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuFor(null)
                          onDeleteConversation(conversation)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500"
                      >
                        <span aria-hidden="true">🗑</span>
                        {t('chat.deleteConversation')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  findUser,
  formatTime,
  getConversationAvatarPath,
  getConversationTitle,
  getLastMessage,
  matchesSearch,
} from '../../features/chat/helpers'
import { UNREAD_LIMIT } from '../../features/chat/api'
import { systemMessageText } from '../../features/chat/systemText'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { OwnProfile } from '../../features/profile/profileApi'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { Avatar } from '../Avatar'
import { BrandLogo } from '../BrandLogo'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { LoadStatus } from '../LoadStatus'
import { ThemeSwitcher } from '../ThemeSwitcher'

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

// The sidebar is dark in both themes, so it uses the side-* colours throughout.
const SIDE_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-side-focus'
const SIDE_ICON_COLOURS = 'text-side-muted hover:bg-side-hover hover:text-side-fg'
const ICON_BUTTON = `inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${SIDE_ICON_COLOURS} ${SIDE_FOCUS} disabled:cursor-not-allowed disabled:opacity-60`

const ICON_PROPS = {
  'aria-hidden': true,
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

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
  // Text in the search box; filters the list by conversation title.
  const [query, setQuery] = useState('')

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

  const rows = conversations
    .map((conversation) => ({
      conversation,
      title: getConversationTitle(conversation, users, currentUserId),
    }))
    .filter((row) => matchesSearch(row.title, query))

  const logoutLabel = signingOut ? t('auth.loggingOut') : t('auth.logout')

  return (
    <div className="flex h-full w-full flex-col bg-side text-side-fg [color-scheme:dark]">
      <header className="flex items-center gap-1 pt-3.5 pr-3 pb-2.5 pl-4">
        <h1 className="min-w-0 flex-1">
          <BrandLogo />
        </h1>
        <button
          type="button"
          onClick={onNewChat}
          aria-label={t('chat.newChat')}
          title={t('chat.newChat')}
          className={ICON_BUTTON}
        >
          <svg {...ICON_PROPS}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNewGroup}
          aria-label={t('chat.newGroup')}
          title={t('chat.newGroup')}
          className={ICON_BUTTON}
        >
          <svg {...ICON_PROPS}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6" />
            <path d="M22 11h-6" />
          </svg>
        </button>
      </header>

      {signOutFailed && (
        <p role="alert" className="mx-3 mb-2.5 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">
          {t('auth.errors.signOutFailed')}
        </p>
      )}

      <div className="px-3 pb-2.5">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-side-hover px-2.5 text-side-muted focus-within:outline-2 focus-within:outline-side-focus">
          <svg {...ICON_PROPS} width={16} height={16} strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">{t('chat.search')}</span>
          {/* 16px text on phones: smaller text makes iOS Safari zoom in on focus. */}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('chat.search')}
            autoComplete="off"
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-base text-side-fg outline-none placeholder:text-side-muted md:text-sm"
          />
        </label>
      </div>

      <nav aria-label={t('chat.listLabel')} className="flex-1 overflow-y-auto px-2 pb-2">
        {list.status === 'loading' && <LoadStatus status="loading" tone="side" />}
        {list.status === 'error' && (
          <LoadStatus status="error" error={list.error} onRetry={list.reload} tone="side" />
        )}
        {list.status === 'ready' && conversations.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-side-muted">{t('chat.noConversations')}</p>
        )}
        {conversations.length > 0 && rows.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-side-muted">{t('chat.noSearchResults')}</p>
        )}
        <ul className="space-y-0.5">
          {rows.map(({ conversation, title }) => {
            const last = getLastMessage(lastMessages, conversation.id)
            const isSelected = conversation.id === selectedId
            const unread = unreadCounts.get(conversation.id) ?? 0
            const menuOpen = menuFor === conversation.id
            const menuId = `conversation-menu-${conversation.id}`
            const metaColour = isSelected ? 'text-white/80' : 'text-side-muted'

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
                  className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-side-focus ${
                    isSelected ? 'bg-accent text-white' : 'hover:bg-side-hover'
                  } pr-11 md:pr-2`}
                >
                  <Avatar
                    id={conversation.id}
                    name={title}
                    avatarPath={getConversationAvatarPath(conversation, users, currentUserId)}
                    size="sm"
                    shape={conversation.type === 'group' ? 'square' : 'circle'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate ${unread > 0 ? 'font-semibold' : 'font-medium'} ${
                          isSelected || unread > 0 ? 'text-white' : ''
                        }`}
                      >
                        {title}
                      </span>
                      {last && (
                        <time dateTime={last.createdAt} className={`shrink-0 text-xs ${metaColour}`}>
                          {formatTime(last.createdAt, language)}
                        </time>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      {last && (
                        <span className={`min-w-0 truncate text-[13px] ${metaColour}`}>
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
                        <span
                          className={`ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold ${
                            isSelected ? 'bg-white text-accent' : 'bg-accent text-white'
                          }`}
                        >
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
                    className={`rounded-md bg-side-hover px-2 py-0.5 text-base leading-none text-side-muted shadow-sm hover:bg-side-line hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-side-focus ${
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
                      className="absolute top-full right-0 z-10 mt-1 w-56 rounded-lg border border-line bg-surface py-1 text-fg shadow-lg"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuFor(null)
                          onDeleteConversation(conversation)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
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

      <div className="flex items-center gap-1 border-t border-side-line py-2.5 pr-2 pl-3">
        {profile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-haspopup="dialog"
            title={t('profile.open')}
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 text-left hover:bg-side-hover ${SIDE_FOCUS}`}
          >
            <Avatar id={profile.id} name={profile.displayName} avatarPath={profile.avatarPath} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{profile.displayName}</span>
              <span className="block truncate text-xs text-side-muted">@{profile.username}</span>
            </span>
            <span className="sr-only">{t('profile.open')}</span>
          </button>
        ) : profileFailed ? (
          <p role="alert" className="flex min-w-0 flex-1 items-center gap-2 text-xs text-red-300">
            <span className="min-w-0 truncate" title={t('profile.loadFailed')}>
              {t('profile.loadFailed')}
            </span>
            <button
              type="button"
              onClick={onRetryProfile}
              className={`shrink-0 rounded-md bg-side-hover px-2 py-1 text-xs text-side-fg hover:bg-side-line ${SIDE_FOCUS}`}
            >
              {t('chat.retry')}
            </button>
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate px-1 text-sm text-side-muted">{t('chat.loading')}</p>
        )}
        <ThemeSwitcher className={`${SIDE_ICON_COLOURS} focus-visible:outline-side-focus`} />
        <LanguageSwitcher
          short
          className={`h-9 rounded-lg border-0 bg-side px-1.5 text-xs font-semibold ${SIDE_ICON_COLOURS} ${SIDE_FOCUS}`}
        />
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          aria-label={logoutLabel}
          title={logoutLabel}
          className={ICON_BUTTON}
        >
          <svg {...ICON_PROPS}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createDirectChat,
  createGroupChat,
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_MAX_LENGTH,
  parseUserSearch,
  searchUsers,
  type GroupCheckErrorKey,
} from '../features/chat/api'
import type { ChatErrorKey } from '../features/chat/chatErrors'
import type { Profile } from '../features/chat/types'
import { useChatQuery } from '../features/chat/useChatQuery'
import { useDebouncedValue } from '../features/chat/useDebouncedValue'
import { Avatar } from './Avatar'
import { CHIP, CLOSE_BUTTON, DIALOG, DIALOG_FOOTER, DIALOG_HEADER, DIALOG_TITLE, ERROR_BAR, FIELD_LABEL, INPUT, PRIMARY_BUTTON, RESULT_ROW, SECONDARY_BUTTON } from './dialogStyles'
import { ICON_PROPS } from './iconProps'

export type NewChatMode = 'direct' | 'group'

interface NewChatDialogProps {
  mode: NewChatMode
  currentUserId: string
  onClose: () => void
  // Called with the id of the new (or, for a direct chat, existing) conversation.
  onCreated: (conversationId: string) => void
}

const SEARCH_DELAY_MS = 300

// Rendered only while open. Direct: pick one user. Group: name it and pick members.
export function NewChatDialog({ mode, currentUserId, onClose, onCreated }: NewChatDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [members, setMembers] = useState<Profile[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ChatErrorKey | GroupCheckErrorKey | null>(null)
  // Blocks a second submit before the pending state has re-rendered.
  const pendingRef = useRef(false)

  // "<username prefix>:<phone>", either part possibly empty; null when nothing can match.
  const parsed = parseUserSearch(query)
  const normalized = parsed && `${parsed.username ?? ''}:${parsed.phone ?? ''}`
  const searchKey = useDebouncedValue(normalized, SEARCH_DELAY_MS)
  // The key embeds the caller so the loader stays a stable module-level function.
  const search = useChatQuery(searchKey === null ? null : `${currentUserId}:${searchKey}`, loadSearch)
  const searchSettled = searchKey === normalized

  // showModal() gives focus trapping, Escape to close and the backdrop. It moves focus to
  // the first focusable element (the close button), so the first field is focused after it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    ;(titleRef.current ?? searchRef.current)?.focus()
  }, [])

  async function run(create: () => Promise<{ ok: true; data: string } | { ok: false; error: ChatErrorKey | GroupCheckErrorKey }>) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      const result = await create()
      if (result.ok) onCreated(result.data)
      else setError(result.error)
    } catch {
      setError('chat.errors.createFailed')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  function handlePick(profile: Profile) {
    if (mode === 'direct') {
      void run(() => createDirectChat(profile.id))
      return
    }
    setError(null)
    setMembers((current) =>
      current.some((member) => member.id === profile.id) ? current : [...current, profile],
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'group') {
      void run(() =>
        createGroupChat(
          title,
          members.map((member) => member.id),
        ),
      )
    }
  }

  const results = search.status === 'ready' ? search.data : []
  const memberIds = new Set(members.map((member) => member.id))
  const full = members.length + 1 >= GROUP_MAX_MEMBERS
  const headingId = 'new-chat-heading'

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={onClose}
      className={DIALOG}
    >
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <header className={`${DIALOG_HEADER} items-center`}>
          <h2 id={headingId} className={DIALOG_TITLE}>
            {mode === 'direct' ? t('chat.newChat') : t('chat.newGroup')}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label={t('chat.dialog.close')}
            className={CLOSE_BUTTON}
          >
            <svg {...ICON_PROPS} strokeWidth={2}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {mode === 'group' && (
            <label className={FIELD_LABEL}>
              {t('chat.dialog.groupTitle')}
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setError(null)
                }}
                autoComplete="off"
                className={INPUT}
              />
            </label>
          )}

          {mode === 'group' && members.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium">
                {t('chat.dialog.selected', { count: members.length })}
              </p>
              <ul className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setMembers((current) => current.filter((item) => item.id !== member.id))
                      }
                      aria-label={t('chat.dialog.remove', { name: member.displayName })}
                      className={CHIP}
                    >
                      {member.displayName}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className={FIELD_LABEL}>
            {t('chat.dialog.searchLabel')}
            {/* type="text": in a search input, Escape clears the text instead of closing the dialog. */}
            <input
              ref={searchRef}
              type="text"
              enterKeyHint="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Enter here must not submit the group form before it is complete.
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault()
              }}
              placeholder={t('chat.dialog.searchPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={INPUT}
            />
          </label>

          <div aria-live="polite" className="text-sm text-muted">
            {query.trim() !== '' && normalized === null && t('chat.dialog.invalidQuery')}
            {normalized !== null && (!searchSettled || search.status === 'loading') && t('chat.dialog.searching')}
            {searchSettled && search.status === 'error' && (
              <span className="text-danger">{t(search.error)}</span>
            )}
            {searchSettled && search.status === 'ready' && results.length === 0 && t('chat.dialog.noResults')}
          </div>

          {searchSettled && results.length > 0 && (
            <ul className="-mx-5">
              {results.map((profile) => {
                const added = memberIds.has(profile.id)
                return (
                  <li key={profile.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(profile)}
                      disabled={pending || added || (mode === 'group' && full)}
                      className={RESULT_ROW}
                    >
                      <Avatar id={profile.id} name={profile.displayName} avatarPath={profile.avatarPath} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{profile.displayName}</span>
                        <span className="block truncate text-sm text-muted">@{profile.username}</span>
                      </span>
                      {added && <span className="text-sm text-accent-fg">{t('chat.dialog.added')}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className={ERROR_BAR}>
            {t(error, { max: GROUP_TITLE_MAX_LENGTH, maxMembers: GROUP_MAX_MEMBERS - 1 })}
          </p>
        )}

        {mode === 'group' && (
          <footer className={`${DIALOG_FOOTER} justify-end`}>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={SECONDARY_BUTTON}
            >
              {t('chat.dialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className={PRIMARY_BUTTON}
            >
              {pending ? t('chat.dialog.creating') : t('chat.dialog.create')}
            </button>
          </footer>
        )}
        {mode === 'direct' && pending && (
          <p role="status" className="border-t border-line px-5 py-2 text-sm text-muted">
            {t('chat.dialog.creating')}
          </p>
        )}
      </form>
    </dialog>
  )
}

// key = "<current user id>:<username prefix>:<phone>". None of the three contains ":".
function loadSearch(key: string) {
  const [userId = '', username = '', phone = ''] = key.split(':')
  return searchUsers({ username: username || null, phone: phone || null }, userId)
}

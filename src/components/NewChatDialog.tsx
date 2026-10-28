import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createDirectChat,
  createGroupChat,
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_MAX_LENGTH,
  normalizeUsernameQuery,
  searchProfiles,
  type GroupCheckErrorKey,
} from '../features/chat/api'
import type { ChatErrorKey } from '../features/chat/chatErrors'
import type { Profile } from '../features/chat/types'
import { useChatQuery } from '../features/chat/useChatQuery'
import { useDebouncedValue } from '../features/chat/useDebouncedValue'
import { Avatar } from './Avatar'

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

  const normalized = normalizeUsernameQuery(query)
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
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 id={headingId} className="font-semibold">
            {mode === 'direct' ? t('chat.newChat') : t('chat.newGroup')}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label={t('chat.dialog.close')}
            className="rounded-full px-2 py-1 text-xl leading-none text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {mode === 'group' && (
            <label className="flex flex-col gap-1 text-sm font-medium">
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
                className="rounded-md border border-slate-300 px-3 py-2 text-base font-normal focus-visible:outline-2 focus-visible:outline-brand-500"
              />
            </label>
          )}

          {mode === 'group' && members.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">
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
                      className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700 hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      {member.displayName}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium">
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
              className="rounded-md border border-slate-300 px-3 py-2 text-base font-normal focus-visible:outline-2 focus-visible:outline-brand-500"
            />
          </label>

          <div aria-live="polite" className="text-sm text-slate-500">
            {query.trim() !== '' && normalized === null && t('chat.dialog.invalidQuery')}
            {normalized !== null && (!searchSettled || search.status === 'loading') && t('chat.dialog.searching')}
            {searchSettled && search.status === 'error' && (
              <span className="text-red-700">{t(search.error)}</span>
            )}
            {searchSettled && search.status === 'ready' && results.length === 0 && t('chat.dialog.noResults')}
          </div>

          {searchSettled && results.length > 0 && (
            <ul className="-mx-4">
              {results.map((profile) => {
                const added = memberIds.has(profile.id)
                return (
                  <li key={profile.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(profile)}
                      disabled={pending || added || (mode === 'group' && full)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Avatar id={profile.id} name={profile.displayName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{profile.displayName}</span>
                        <span className="block truncate text-sm text-slate-500">@{profile.username}</span>
                      </span>
                      {added && <span className="text-sm text-brand-700">{t('chat.dialog.added')}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
            {t(error, { max: GROUP_TITLE_MAX_LENGTH, maxMembers: GROUP_MAX_MEMBERS - 1 })}
          </p>
        )}

        {mode === 'group' && (
          <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              {t('chat.dialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? t('chat.dialog.creating') : t('chat.dialog.create')}
            </button>
          </footer>
        )}
        {mode === 'direct' && pending && (
          <p role="status" className="border-t border-slate-200 px-4 py-2 text-sm text-slate-500">
            {t('chat.dialog.creating')}
          </p>
        )}
      </form>
    </dialog>
  )
}

// key = "<current user id>:<normalized query>"
function loadSearch(key: string) {
  const separator = key.indexOf(':')
  return searchProfiles(key.slice(separator + 1), key.slice(0, separator))
}

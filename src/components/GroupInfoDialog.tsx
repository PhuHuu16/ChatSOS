import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addGroupMembers,
  GROUP_MAX_MEMBERS,
  GROUP_TITLE_MAX_LENGTH,
  leaveGroup,
  parseUserSearch,
  removeGroupMember,
  renameGroup,
  searchUsers,
  transferGroupOwnership,
  type ChatResult,
  type GroupTitleCheck,
} from '../features/chat/api'
import type { ChatErrorKey } from '../features/chat/chatErrors'
import { findUser } from '../features/chat/helpers'
import type { Conversation, Profile, User } from '../features/chat/types'
import { useChatQuery } from '../features/chat/useChatQuery'
import { useDebouncedValue } from '../features/chat/useDebouncedValue'
import { Avatar } from './Avatar'
import { CHIP, CLOSE_BUTTON, DANGER_OUTLINE_BUTTON, DIALOG, DIALOG_FOOTER, DIALOG_HEADER, DIALOG_TITLE, ERROR_BAR, FIELD_LABEL, INPUT, PRIMARY_BUTTON, RESULT_ROW, SECTION_HEADING, SMALL_BUTTON } from './dialogStyles'
import { ICON_PROPS } from './iconProps'

interface GroupInfoDialogProps {
  // The open group, kept up to date by the caller (title, members, owner).
  conversation: Conversation
  users: User[]
  currentUserId: string
  onClose: () => void
  // A change was saved: the caller reloads the list.
  onChanged: () => void
  // The user left the group (or had already left it, e.g. in another tab).
  onLeft: () => void
}

type DialogError = ChatErrorKey | Extract<GroupTitleCheck, { ok: false }>['error']
type Busy = 'rename' | 'add' | 'leave' | `remove:${string}` | `owner:${string}`

const SEARCH_DELAY_MS = 300

// Rendered only while open. Every member can rename the group and add people; the owner
// can also remove members and hand the group over. Anyone can leave.
export function GroupInfoDialog({
  conversation,
  users,
  currentUserId,
  onClose,
  onChanged,
  onLeft,
}: GroupInfoDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(conversation.title ?? '')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Profile[]>([])
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState<DialogError | null>(null)
  // Blocks a second action before the busy state has re-rendered.
  const busyRef = useRef(false)

  const isOwner = conversation.ownerId === currentUserId
  const memberIds = new Set(conversation.memberIds)
  const seatsLeft = Math.max(0, GROUP_MAX_MEMBERS - conversation.memberIds.length - picked.length)
  const nameOf = (id: string) => findUser(users, id)?.displayName || t('chat.system.someone')
  // The owner first, then the user, then everyone else by name.
  const members = [...conversation.memberIds].sort((a, b) => {
    const rank = (id: string) => (id === conversation.ownerId ? 0 : id === currentUserId ? 1 : 2)
    return rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b))
  })

  const parsed = parseUserSearch(query)
  const normalized = parsed && `${parsed.username ?? ''}:${parsed.phone ?? ''}`
  const searchKey = useDebouncedValue(normalized, SEARCH_DELAY_MS)
  const search = useChatQuery(searchKey === null ? null : `${currentUserId}:${searchKey}`, loadSearch)
  const searchSettled = searchKey === normalized
  const results = search.status === 'ready' ? search.data : []

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  // Runs one change at a time. Resolves to whether it succeeded.
  async function run<T>(action: Busy, work: () => Promise<ChatResult<T>>): Promise<ChatResult<T>> {
    if (busyRef.current) return { ok: false, error: 'chat.errors.groupChangeFailed' }
    busyRef.current = true
    setBusy(action)
    setError(null)
    const result = await work().catch(
      (): ChatResult<T> => ({ ok: false, error: 'chat.errors.groupChangeFailed' }),
    )
    busyRef.current = false
    setBusy(null)
    if (!result.ok) setError(result.error)
    else onChanged()
    return result
  }

  function handleRename(event: FormEvent) {
    event.preventDefault()
    void run('rename', () => renameGroup(conversation.id, name)).then((result) => {
      if (result.ok) setName(result.data)
    })
  }

  function handleAdd() {
    const ids = picked.map((profile) => profile.id)
    void run('add', () => addGroupMembers(conversation.id, ids)).then((result) => {
      if (!result.ok) return
      setPicked([])
      setQuery('')
    })
  }

  function handleRemove(userId: string) {
    if (!window.confirm(t('chat.groupDialog.removeConfirm', { name: nameOf(userId) }))) return
    void run(`remove:${userId}`, () => removeGroupMember(conversation.id, userId))
  }

  function handleMakeOwner(userId: string) {
    if (!window.confirm(t('chat.groupDialog.makeOwnerConfirm', { name: nameOf(userId) }))) return
    void run(`owner:${userId}`, () => transferGroupOwnership(conversation.id, userId))
  }

  function handleLeave() {
    const title = conversation.title ?? ''
    const question =
      conversation.memberIds.length <= 1
        ? t('chat.groupDialog.leaveConfirmLast', { name: title })
        : isOwner
          ? t('chat.groupDialog.leaveConfirmOwner', { name: title })
          : t('chat.groupDialog.leaveConfirm', { name: title })
    if (!window.confirm(question)) return
    void run('leave', () => leaveGroup(conversation.id)).then((result) => {
      // Already gone (e.g. left in another tab) ends the same way.
      if (result.ok || result.error === 'chat.errors.groupGone') onLeft()
    })
  }

  const headingId = 'group-info-heading'
  const pending = busy !== null
  const nameUnchanged = name.trim() === (conversation.title ?? '')

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={onClose}
      // While a change runs, Escape must not close the dialog and hide its result.
      onCancel={(event) => {
        if (busyRef.current) event.preventDefault()
      }}
      className={DIALOG}
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className={`${DIALOG_HEADER} items-center`}>
          <h2 id={headingId} className={DIALOG_TITLE}>
            {t('chat.groupDialog.title')}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={pending}
            aria-label={t('chat.groupDialog.close')}
            className={CLOSE_BUTTON}
          >
            <svg {...ICON_PROPS} strokeWidth={2}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <form onSubmit={handleRename} className="flex flex-col gap-1.5">
            <label htmlFor="group-name" className="text-sm font-medium">
              {t('chat.groupDialog.nameLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="group-name"
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
                autoComplete="off"
                className={`${INPUT} min-w-0 flex-1`}
              />
              <button
                type="submit"
                disabled={pending || nameUnchanged}
                className={PRIMARY_BUTTON}
              >
                {busy === 'rename' ? t('chat.groupDialog.savingName') : t('chat.groupDialog.saveName')}
              </button>
            </div>
          </form>

          <section aria-labelledby="group-members-heading">
            <h3 id="group-members-heading" className={`mb-1 ${SECTION_HEADING}`}>
              {t('chat.groupDialog.members', { count: conversation.memberIds.length })}
            </h3>
            <ul className="-mx-5">
              {members.map((id) => {
                const user = findUser(users, id)
                const displayName = nameOf(id)
                const isMe = id === currentUserId
                return (
                  <li key={id} className="flex items-center gap-3 px-5 py-2">
                    <Avatar id={id} name={displayName} avatarPath={user?.avatarPath ?? null} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {displayName} {isMe && <span className="font-normal text-muted">{t('chat.groupDialog.you')}</span>}
                      </span>
                      {id === conversation.ownerId && (
                        <span className="mt-0.5 inline-block rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-muted">{t('chat.groupDialog.owner')}</span>
                      )}
                    </span>
                    {isOwner && !isMe && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => handleMakeOwner(id)}
                          disabled={pending}
                          aria-label={t('chat.groupDialog.makeOwnerLabel', { name: displayName })}
                          className={`${SMALL_BUTTON} text-fg hover:bg-subtle`}
                        >
                          {busy === `owner:${id}` ? t('chat.groupDialog.working') : t('chat.groupDialog.makeOwner')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(id)}
                          disabled={pending}
                          aria-label={t('chat.groupDialog.removeLabel', { name: displayName })}
                          className={`${SMALL_BUTTON} text-danger hover:bg-danger-soft`}
                        >
                          {busy === `remove:${id}` ? t('chat.groupDialog.working') : t('chat.groupDialog.remove')}
                        </button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section aria-labelledby="group-add-heading" className="flex flex-col gap-2">
            <h3 id="group-add-heading" className="text-sm font-medium">
              {t('chat.groupDialog.addTitle')}{' '}
              <span className="font-normal text-muted">
                {seatsLeft > 0
                  ? t('chat.groupDialog.seatsLeft', { count: seatsLeft })
                  : t('chat.groupDialog.full', { total: GROUP_MAX_MEMBERS })}
              </span>
            </h3>

            {picked.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {picked.map((profile) => (
                  <li key={profile.id}>
                    <button
                      type="button"
                      onClick={() => setPicked((current) => current.filter((item) => item.id !== profile.id))}
                      disabled={pending}
                      aria-label={t('chat.dialog.remove', { name: profile.displayName })}
                      className={CHIP}
                    >
                      {profile.displayName}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className={FIELD_LABEL}>
              {t('chat.dialog.searchLabel')}
              {/* type="text": in a search input, Escape clears the text instead of closing the dialog. */}
              <input
                type="text"
                enterKeyHint="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
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
                  const inGroup = memberIds.has(profile.id)
                  const isPicked = picked.some((item) => item.id === profile.id)
                  return (
                    <li key={profile.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null)
                          setPicked((current) => [...current, profile])
                        }}
                        disabled={pending || inGroup || isPicked || seatsLeft === 0}
                        className={RESULT_ROW}
                      >
                        <Avatar id={profile.id} name={profile.displayName} avatarPath={profile.avatarPath} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{profile.displayName}</span>
                          <span className="block truncate text-sm text-muted">@{profile.username}</span>
                        </span>
                        {inGroup && <span className="text-sm text-muted">{t('chat.groupDialog.alreadyMember')}</span>}
                        {isPicked && <span className="text-sm text-accent-fg">{t('chat.dialog.added')}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {picked.length > 0 && (
              <button
                type="button"
                onClick={handleAdd}
                disabled={pending}
                className={`self-end ${PRIMARY_BUTTON}`}
              >
                {busy === 'add' ? t('chat.groupDialog.adding') : t('chat.groupDialog.add', { count: picked.length })}
              </button>
            )}
          </section>
        </div>

        {error && (
          <p role="alert" className={ERROR_BAR}>
            {t(error, { max: GROUP_TITLE_MAX_LENGTH, total: GROUP_MAX_MEMBERS })}
          </p>
        )}

        <footer className={`${DIALOG_FOOTER} justify-between`}>
          <button
            type="button"
            onClick={handleLeave}
            disabled={pending}
            className={DANGER_OUTLINE_BUTTON}
          >
            {busy === 'leave' ? t('chat.groupDialog.working') : t('chat.groupDialog.leave')}
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={pending}
            className={PRIMARY_BUTTON}
          >
            {t('chat.groupDialog.close')}
          </button>
        </footer>
      </div>
    </dialog>
  )
}

// key = "<current user id>:<username prefix>:<phone>". None of the three contains ":".
function loadSearch(key: string) {
  const [userId = '', username = '', phone = ''] = key.split(':')
  return searchUsers({ username: username || null, phone: phone || null }, userId)
}

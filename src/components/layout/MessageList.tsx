import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchMessagesBefore,
  MESSAGE_CHANGE_WINDOW_MS,
  MESSAGE_PAGE_SIZE,
  MESSAGE_SELECT_LIMIT,
  type ChatResult,
} from '../../features/chat/api'
import type { ChatErrorKey } from '../../features/chat/chatErrors'
import {
  daysAgo,
  findUser,
  formatDay,
  formatTime,
  mergeMessages,
  readersOf,
  startsGroup,
  timestampMicros,
  unknownUserIds,
  withLiveMessages,
  withoutHidden,
  withUpdates,
} from '../../features/chat/helpers'
import { systemMessageText } from '../../features/chat/systemText'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { PendingMessage } from '../../features/chat/useOutgoingMessages'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { AttachmentView } from '../AttachmentView'
import { Avatar } from '../Avatar'
import { ICON_PROPS } from '../iconProps'
import { LoadStatus } from '../LoadStatus'

interface MessageListProps {
  conversation: Conversation
  latest: ChatQueryState<Message[]>
  live: Message[]
  pending: PendingMessage[]
  users: User[]
  currentUserId: string
  unreadCount: number
  readMarker: string | null
  othersRead: ReadonlyMap<string, string | null>
  typingNames: string[]
  updates: ReadonlyMap<string, Message>
  editingId: string | null
  changingId: string | null
  onStartEdit: (message: Message) => void
  onRecall: (message: Message) => void
  hidden: ReadonlySet<string>
  selectedIds: ReadonlySet<string> | null
  onToggleSelect: (message: Message) => void
  onRetry: (message: PendingMessage) => void
  onDiscard: (message: PendingMessage) => void
  onRead: (conversationId: string, readAt: string) => void
  onUnknownUsers: (ids: string[]) => void
}

interface OlderMessages {
  messages: Message[]
  hasMore: boolean | null
  error: ChatErrorKey | null
}

const ROW_X = 'px-4 md:px-5'
const TEXT_INSET = 'pr-4 pl-16 md:pr-5 md:pl-17'
const SMALL_BUTTON_CLASS =
  'rounded px-1 font-medium underline hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
const TOOL_BUTTON_CLASS =
  'inline-flex size-8 items-center justify-center rounded-md hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'
const STICK_DISTANCE = 80
const LOAD_OLDER_DISTANCE = 200
const MAX_JUMP_PAGES = 3
const JUMP_MARGIN = 48
const MAX_READER_NAMES = 3
const CHANGE_WINDOW_TICK = 5000

// Danh sách tin nhắn
export function MessageList({
  conversation,
  latest,
  live,
  pending,
  users,
  currentUserId,
  unreadCount,
  readMarker,
  othersRead,
  typingNames,
  updates,
  editingId,
  changingId,
  onStartEdit,
  onRecall,
  hidden,
  selectedIds,
  onToggleSelect,
  onRetry,
  onDiscard,
  onRead,
  onUnknownUsers,
}: MessageListProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  const listRef = useRef<HTMLDivElement>(null)

  const [openMarker] = useState(readMarker)
  const [openUnread] = useState(unreadCount)
  const positionedRef = useRef(false)
  const [positioned, setPositioned] = useState(false)
  const jumpPagesRef = useRef(0)
  const stickRef = useRef(openUnread === 0)
  const [atBottom, setAtBottom] = useState(true)

  const [older, setOlder] = useState<OlderMessages>({ messages: [], hasMore: null, error: null })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  const anchorRef = useRef<{ id: string; bottom: number } | null>(null)
  const messagesRef = useRef<HTMLOListElement>(null)
  const seekingBottomRef = useRef(false)

  const [now, setNow] = useState(() => Date.now())
  const [menuFor, setMenuFor] = useState<string | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CHANGE_WINDOW_TICK)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (menuFor === null) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-message-menu]')) return
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

  const latestData = latest.status === 'ready' ? latest.data : null
  const loaded = latestData ? mergeMessages(older.messages, latestData) : null
  const hasMore = older.hasMore ?? (latestData ? latestData.length >= MESSAGE_PAGE_SIZE : false)
  const shown = loaded
    ? withoutHidden(
        withUpdates(withLiveMessages(loaded, live, conversation.id, !hasMore), updates),
        hidden,
      )
    : []
  const selecting = selectedIds !== null
  const selectFull = (selectedIds?.size ?? 0) >= MESSAGE_SELECT_LIMIT
  const shownIds = new Set(shown.map((message) => message.id))
  const pendingHere = pending.filter(
    (message) => message.conversationId === conversation.id && !shownIds.has(message.id),
  )
  const seenPendingRef = useRef<Set<string> | null>(null)
  const pendingIds = pendingHere.map((message) => message.id).join()
  const shownCount = shown.length + pendingHere.length
  const pendingStatuses = pendingHere.map((message) => message.status).join()
  const newest = loaded ? shown.at(-1) : undefined
  const receiptFor =
    newest &&
    newest.senderId === currentUserId &&
    newest.kind !== 'system' &&
    newest.deletedAt === null &&
    pendingHere.length === 0
      ? newest
      : undefined
  const readerNames = receiptFor
    ? readersOf(receiptFor, othersRead).map((id) => findUser(users, id)?.displayName ?? '')
    : []
  const receipt = !receiptFor
    ? null
    : readerNames.length === 0
      ? t('chat.sent')
      : conversation.type === 'direct'
        ? t('chat.seen')
        : t('chat.seenBy', {
            names:
              readerNames.slice(0, MAX_READER_NAMES).join(', ') +
              (readerNames.length > MAX_READER_NAMES
                ? ` +${readerNames.length - MAX_READER_NAMES}`
                : ''),
          })
  const openMarkerMicros = openMarker === null ? -Infinity : timestampMicros(openMarker)
  const firstUnreadId =
    openUnread > 0
      ? shown.find(
          (message) =>
            message.senderId !== currentUserId &&
            message.kind !== 'system' &&
            timestampMicros(message.createdAt) > openMarkerMicros,
        )?.id
      : undefined

  async function loadOlder() {
    const oldest = loaded?.[0]
    if (loadingOlderRef.current || !oldest || !hasMore) return
    const newestPage = latestData ?? []
    loadingOlderRef.current = true
    setLoadingOlder(true)
    const result = await fetchMessagesBefore(conversation.id, oldest).catch(
      (): ChatResult<Message[]> => ({ ok: false, error: 'chat.errors.loadFailed' }),
    )
    loadingOlderRef.current = false
    setLoadingOlder(false)
    if (!result.ok) {
      setOlder((state) => ({ ...state, error: result.error }))
      return
    }
    setOlder((state) => ({
      messages: mergeMessages(result.data, state.messages, newestPage),
      hasMore: result.data.length >= MESSAGE_PAGE_SIZE,
      error: null,
    }))
  }

  function markReadIfSeen() {
    if (!positionedRef.current || !newest || !stickRef.current) return
    if (document.visibilityState !== 'visible') return
    onRead(conversation.id, newest.createdAt)
  }
  const markReadFromEffect = useEffectEvent(markReadIfSeen)

  function scrollToBottom() {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }

  function findAnchor(list: HTMLElement): { id: string; bottom: number } | null {
    const rows = list.querySelectorAll<HTMLElement>('[data-message-id]')
    const top = list.getBoundingClientRect().top
    let low = 0
    let high = rows.length - 1
    let found: HTMLElement | undefined
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const row = rows[middle]
      if (row && row.getBoundingClientRect().bottom > top) {
        found = row
        high = middle - 1
      } else {
        low = middle + 1
      }
    }
    const id = found?.dataset.messageId
    if (!found || !id) return null
    return { id, bottom: found.getBoundingClientRect().bottom - top }
  }

  const keepInView = useEffectEvent(() => {
    const list = listRef.current
    if (!list || !positionedRef.current) return
    const anchor = anchorRef.current
    if (stickRef.current) {
      scrollToBottom()
    } else if (anchor) {
      const row = list.querySelector(`[data-message-id="${anchor.id}"]`)
      if (row) {
        const shift =
          row.getBoundingClientRect().bottom - list.getBoundingClientRect().top - anchor.bottom
        if (Math.abs(shift) >= 1) list.scrollTop += shift
      }
      if (seekingBottomRef.current) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
    }
    anchorRef.current = findAnchor(list)
  })
  useEffect(() => {
    const messages = messagesRef.current
    if (!messages) return
    const observer = new ResizeObserver(() => keepInView())
    observer.observe(messages)
    return () => observer.disconnect()
  }, [])

  const position = useEffectEvent(() => {
    const list = listRef.current
    if (positionedRef.current || !loaded || !list) return
    if (openUnread > 0) {
      const oldest = loaded[0]
      const mayMissEarlierUnread =
        hasMore && (!oldest || timestampMicros(oldest.createdAt) > openMarkerMicros)
      const canLoadMore = jumpPagesRef.current < MAX_JUMP_PAGES && !older.error
      if (mayMissEarlierUnread && canLoadMore) {
        if (!loadingOlderRef.current) {
          jumpPagesRef.current += 1
          void loadOlder()
        }
        return
      }
      const target = firstUnreadId
        ? list.querySelector(`[data-message-id="${firstUnreadId}"]`)
        : null
      if (target) {
        positionedRef.current = true
        setPositioned(true)
        list.scrollTop +=
          target.getBoundingClientRect().top - list.getBoundingClientRect().top - JUMP_MARGIN
        stickRef.current =
          list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_DISTANCE
        if (stickRef.current) scrollToBottom()
        anchorRef.current = findAnchor(list)
        markReadIfSeen()
        return
      }
    }
    positionedRef.current = true
    setPositioned(true)
    stickRef.current = true
    scrollToBottom()
    anchorRef.current = findAnchor(list)
    markReadIfSeen()
  })
  useLayoutEffect(() => {
    position()
  }, [latestData, older.messages.length, older.hasMore, older.error])

  const followNewMessages = useEffectEvent(() => {
    const seen = seenPendingRef.current
    if (seen === null) {
      seenPendingRef.current = new Set(pendingHere.map((message) => message.id))
    } else {
      for (const message of pendingHere) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
        stickRef.current = true
      }
    }
    if (positionedRef.current && stickRef.current) scrollToBottom()
  })
  useEffect(() => {
    followNewMessages()
  }, [shownCount, pendingStatuses, pendingIds])

  useEffect(() => {
    markReadFromEffect()
  }, [newest?.id])

  const unknownIds = unknownUserIds(shown, users).join()
  const reportUnknown = useEffectEvent((ids: string) => onUnknownUsers(ids.split(',')))
  useEffect(() => {
    if (unknownIds) reportUnknown(unknownIds)
  }, [unknownIds])

  useEffect(() => {
    const handleVisibility = () => markReadFromEffect()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  function dayText(iso: string): string {
    const days = daysAgo(iso, now)
    if (days <= 0) return t('chat.today')
    if (days === 1) return t('chat.yesterday')
    return formatDay(iso, language, now)
  }

  function nameOf(userId: string): string {
    const name = findUser(users, userId)?.displayName
    if (name) return name
    return userId === currentUserId ? t('chat.you') : t('chat.system.someone')
  }

  const ownUser = findUser(users, currentUserId)
  const ownAsSender = (createdAt: string) =>
    ({ senderId: currentUserId, kind: 'text', createdAt }) as const

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget
          const isAtBottom =
            list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_DISTANCE
          if (positionedRef.current) {
            stickRef.current = isAtBottom
            anchorRef.current = findAnchor(list)
          }
          if (isAtBottom) seekingBottomRef.current = false
          if (isAtBottom !== atBottom) setAtBottom(isAtBottom)
          if (isAtBottom) markReadIfSeen()
          if (
            positionedRef.current &&
            !seekingBottomRef.current &&
            list.scrollTop < LOAD_OLDER_DISTANCE
          ) {
            void loadOlder()
          }
        }}
        onWheel={() => (seekingBottomRef.current = false)}
        onTouchStart={() => (seekingBottomRef.current = false)}
        onKeyDown={() => (seekingBottomRef.current = false)}
        className="h-full overflow-y-auto pt-3 pb-10"
      >
        {latest.status === 'loading' && <LoadStatus status="loading" />}
        {latest.status === 'error' && (
          <LoadStatus status="error" error={latest.error} onRetry={latest.reload} />
        )}
        {loaded && !loadingOlder && older.error && (
          <LoadStatus status="error" error={older.error} onRetry={() => void loadOlder()} />
        )}
        {loaded && (loadingOlder || (!older.error && hasMore)) && (
          <div className="mb-2 flex h-7 items-center justify-center">
            {loadingOlder ? (
              <p role="status" className="text-sm text-muted">
                {t('chat.loading')}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="rounded-full px-3 py-1 text-sm text-accent-fg hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t('chat.loadOlder')}
              </button>
            )}
          </div>
        )}
        {loaded && shownCount === 0 && (
          <p className="py-6 text-center text-sm text-muted">{t('chat.noMessages')}</p>
        )}
        <ol
          ref={messagesRef}
          className={`text-[15px] leading-normal md:text-sm ${positioned ? '' : 'invisible'}`}
        >
          {shown.map((message, index) => {
            const previous = shown[index - 1]
            const daySeparator = (!previous ||
              daysAgo(previous.createdAt, Date.parse(message.createdAt)) !== 0) && (
              <li
                role="separator"
                aria-label={dayText(message.createdAt)}
                className={`flex items-center gap-3 ${ROW_X} pt-4 pb-1 text-xs font-semibold text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line`}
              >
                {dayText(message.createdAt)}
              </li>
            )
            const isFirstUnread = message.id === firstUnreadId
            const divider = isFirstUnread && (
              <li
                role="separator"
                aria-label={t('chat.unreadDivider')}
                className={`flex items-center gap-3 ${ROW_X} pt-2.5 pb-1 text-xs font-semibold text-accent-fg before:h-px before:flex-1 before:bg-accent`}
              >
                {t('chat.unreadDivider')}
              </li>
            )
            if (message.system) {
              return (
                <Fragment key={message.id}>
                  {daySeparator}
                  {divider}
                  <li
                    data-message-id={message.id}
                    className={`${ROW_X} py-1.5 text-center text-xs text-muted`}
                  >
                    {systemMessageText(t, message, users, currentUserId)}
                    {' · '}
                    <time dateTime={message.createdAt}>
                      {formatTime(message.createdAt, language)}
                    </time>
                  </li>
                </Fragment>
              )
            }
            const isMine = message.senderId === currentUserId
            const head = isFirstUnread || startsGroup(previous, message)
            const senderName = nameOf(message.senderId)
            const recalled = message.deletedAt !== null
            const canChange =
              isMine && !recalled && now - Date.parse(message.createdAt) < MESSAGE_CHANGE_WINDOW_MS
            const selected = selectedIds?.has(message.id) ?? false
            const menuOpen = !selecting && menuFor === message.id
            const changing = message.id === changingId
            const rowColour =
              selected || message.id === editingId
                ? 'bg-accent-soft'
                : menuOpen
                  ? 'bg-hover'
                  : 'hover:bg-hover'
            const time = (
              <time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>
            )

            const toolbar = !selecting && (
              <>
                <div
                  data-message-menu
                  className={`absolute -top-3.5 right-4 z-10 flex gap-0.5 rounded-lg border border-line bg-canvas p-0.5 text-muted shadow-md md:right-5 [@media(hover:none)]:right-12 ${
                    menuOpen
                      ? ''
                      : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden'
                  }`}
                >
                  {canChange && message.kind === 'text' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuFor(null)
                        onStartEdit(message)
                      }}
                      disabled={changing}
                      aria-label={t('chat.edit')}
                      title={t('chat.edit')}
                      className={`${TOOL_BUTTON_CLASS} hover:text-fg`}
                    >
                      <svg {...ICON_PROPS} width={16} height={16}>
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuFor(null)
                      onToggleSelect(message)
                    }}
                    disabled={changing}
                    aria-label={t('chat.select')}
                    title={t('chat.select')}
                    className={`${TOOL_BUTTON_CLASS} hover:text-fg`}
                  >
                    <svg {...ICON_PROPS} width={16} height={16}>
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <path d="m8 12 3 3 5-6" />
                    </svg>
                  </button>
                  {canChange && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuFor(null)
                        onRecall(message)
                      }}
                      disabled={changing}
                      aria-label={t('chat.recall')}
                      title={t('chat.recall')}
                      className={`${TOOL_BUTTON_CLASS} text-danger`}
                    >
                      <svg {...ICON_PROPS} width={16} height={16}>
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 14h10l1-14" />
                      </svg>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  data-message-menu
                  aria-label={t('chat.messageActions')}
                  aria-expanded={menuOpen}
                  disabled={changing}
                  onClick={() => setMenuFor(menuOpen ? null : message.id)}
                  className="absolute top-1 right-3 rounded-md px-2 py-0.5 text-base leading-none text-muted hover:bg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [@media(hover:hover)]:hidden"
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              </>
            )

            return (
              <Fragment key={message.id}>
                {daySeparator}
                {divider}
                <li
                  data-message-id={message.id}
                  onClick={selecting ? () => onToggleSelect(message) : undefined}
                  className={`group relative flex gap-3 ${ROW_X} ${head ? 'pt-2' : 'pt-0.5'} pb-0.5 ${rowColour} ${
                    selecting ? 'cursor-pointer' : ''
                  }`}
                >
                  {selecting && (
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!selected && selectFull}
                      onChange={() => onToggleSelect(message)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={t('chat.selectMessage')}
                      className="mt-1 size-4 shrink-0 self-start accent-accent"
                    />
                  )}
                  <div className="w-9 shrink-0">
                    {head ? (
                      <Avatar
                        id={message.senderId}
                        name={senderName}
                        avatarPath={findUser(users, message.senderId)?.avatarPath ?? null}
                        size="sm"
                        shape="square"
                      />
                    ) : (
                      <span
                        className={`block pt-0.5 text-right text-[11px] leading-5 text-muted group-hover:opacity-100 ${
                          menuOpen ? '' : 'opacity-0'
                        }`}
                      >
                        {time}
                      </span>
                    )}
                  </div>
                  <div
                    className={`min-w-0 flex-1 ${changing ? 'opacity-60' : ''} ${
                      selecting ? 'pointer-events-none' : ''
                    }`}
                  >
                    {head && (
                      <p className="flex items-baseline gap-2">
                        <span className="truncate font-semibold">{senderName}</span>
                        <span className="shrink-0 text-xs text-muted">{time}</span>
                      </p>
                    )}
                    {recalled ? (
                      <p className="text-muted italic">{t('chat.recalled')}</p>
                    ) : (
                      <>
                        {message.attachment && (message.kind === 'image' || message.kind === 'file') && (
                          <div className="mt-1">
                            <AttachmentView
                              kind={message.kind}
                              attachment={message.attachment}
                            />
                          </div>
                        )}
                        {message.content && (
                          <p className="whitespace-pre-wrap wrap-break-word">
                            {message.content}
                            {message.editedAt && (
                              <span className="ml-1 text-xs text-muted">({t('chat.edited')})</span>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {toolbar}
                </li>
              </Fragment>
            )
          })}
          {pendingHere.map((message, index) => {
            const previousPending = pendingHere[index - 1]
            const previous = previousPending ? ownAsSender(previousPending.createdAt) : shown.at(-1)
            const head = startsGroup(previous, ownAsSender(message.createdAt))
            return (
              <li key={message.id} className={`flex gap-3 ${ROW_X} ${head ? 'pt-2' : 'pt-0.5'} pb-0.5`}>
                <div className="w-9 shrink-0">
                  {head && (
                    <Avatar
                      id={currentUserId}
                      name={nameOf(currentUserId)}
                      avatarPath={ownUser?.avatarPath ?? null}
                      size="sm"
                      shape="square"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {head && <p className="font-semibold">{nameOf(currentUserId)}</p>}
                  <div className={message.status === 'failed' ? '' : 'opacity-70'}>
                    {message.upload && (
                      <div className="mt-1">
                        <AttachmentView
                          kind={message.upload.checked.kind}
                          attachment={{
                            path: message.upload.path,
                            name: message.upload.checked.name,
                            size: message.upload.checked.size,
                            mime: message.upload.checked.mime,
                          }}
                          pending
                        />
                      </div>
                    )}
                    {message.content && (
                      <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                    )}
                  </div>
                  {message.status === 'sending' ? (
                    <p role="status" className="mt-0.5 text-xs text-muted">
                      {t(message.upload ? 'chat.uploading' : 'chat.sending')}
                    </p>
                  ) : (
                    <div role="alert" className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-danger">
                      <p>{t(message.error ?? 'chat.errors.sendFailed')}</p>
                      <button
                        type="button"
                        onClick={() => onRetry(message)}
                        className={SMALL_BUTTON_CLASS}
                      >
                        {t('chat.retry')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDiscard(message)}
                        className={SMALL_BUTTON_CLASS}
                      >
                        {t('chat.discard')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        {receipt && positioned && (
          <p className={`mt-0.5 text-xs text-muted ${TEXT_INSET}`}>{receipt}</p>
        )}
      </div>
      <p
        role="status"
        className={`pointer-events-none absolute bottom-1 left-4 rounded-md bg-canvas/90 px-2 py-0.5 text-xs text-muted md:left-5 ${
          typingNames.length ? '' : 'sr-only'
        }`}
      >
        {typingNames.length > 0 &&
          t('chat.typing', { count: typingNames.length, names: typingNames.join(', ') })}
      </p>
      {!atBottom && unreadCount > 0 && (
        <button
          type="button"
          onClick={() => {
            const list = listRef.current
            if (!list) return
            seekingBottomRef.current = true
            list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
          }}
          className="absolute right-4 bottom-4 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-md hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t('chat.newMessages', { count: unreadCount })} <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  )
}

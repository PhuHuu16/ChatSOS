import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMessagesBefore, MESSAGE_PAGE_SIZE, type ChatResult } from '../../features/chat/api'
import type { ChatErrorKey } from '../../features/chat/chatErrors'
import {
  findUser,
  formatTime,
  mergeMessages,
  timestampMicros,
  withLiveMessages,
} from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { PendingMessage } from '../../features/chat/useOutgoingMessages'
import { DEFAULT_LANGUAGE } from '../../i18n'
import { AttachmentView } from '../AttachmentView'
import { LoadStatus } from '../LoadStatus'

interface MessageListProps {
  conversation: Conversation
  // The newest page of the conversation's messages, oldest first.
  latest: ChatQueryState<Message[]>
  // Messages sent or received since the chat screen opened, of every conversation.
  live: Message[]
  // Not yet confirmed messages, of every conversation.
  pending: PendingMessage[]
  users: User[]
  currentUserId: string
  unreadCount: number
  // The user's read marker for this conversation (ISO 8601), or null when none is read.
  readMarker: string | null
  onRetry: (message: PendingMessage) => void
  onDiscard: (id: string) => void
  // The user has seen the conversation up to the message created at `readAt`.
  onRead: (conversationId: string, readAt: string) => void
}

interface OlderMessages {
  // Every message loaded before the newest page, oldest first.
  messages: Message[]
  // null until an older page has loaded.
  hasMore: boolean | null
  error: ChatErrorKey | null
}

const BUBBLE_CLASS = 'max-w-[75%] rounded-2xl px-3 py-2'
const MINE_CLASS = 'rounded-br-sm bg-brand-100'
const SMALL_BUTTON_CLASS =
  'rounded px-1 font-medium underline hover:text-red-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500'
// Within this distance (px) of the bottom, new messages keep the list scrolled down.
const STICK_DISTANCE = 80
// Older messages load when the list is scrolled this close (px) to the top.
const LOAD_OLDER_DISTANCE = 200
// Opening a conversation loads at most this many older pages to reach the first unread.
const MAX_JUMP_PAGES = 3
// Space (px) left above the first unread message for the divider.
const JUMP_MARGIN = 48

// The messages of one conversation. Render with `key` = conversation id: everything here
// (older pages, scroll position, the unread divider) belongs to that conversation.
export function MessageList({
  conversation,
  latest,
  live,
  pending,
  users,
  currentUserId,
  unreadCount,
  readMarker,
  onRetry,
  onDiscard,
  onRead,
}: MessageListProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  const isGroup = conversation.type === 'group'
  const listRef = useRef<HTMLDivElement>(null)

  // Where unread messages started when the conversation was opened. The divider stays
  // there while the user reads, even as the messages get marked read.
  const [openMarker] = useState(readMarker)
  const [openUnread] = useState(unreadCount)
  // The list is positioned once after loading: at the first unread message, or the bottom.
  // Until then it is hidden, so it does not jump while older pages load.
  const positionedRef = useRef(false)
  const [positioned, setPositioned] = useState(false)
  const jumpPagesRef = useRef(0)
  // Whether the list is at (or near) the bottom, so new messages should keep it there.
  const stickRef = useRef(openUnread === 0)
  const [atBottom, setAtBottom] = useState(true)

  const [older, setOlder] = useState<OlderMessages>({ messages: [], hasMore: null, error: null })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  // The scroll position to keep when older messages are added above.
  const anchorRef = useRef<{ height: number; top: number } | null>(null)

  const latestData = latest.status === 'ready' ? latest.data : null
  const loaded = latestData ? mergeMessages(older.messages, latestData) : null
  const hasMore = older.hasMore ?? (latestData ? latestData.length >= MESSAGE_PAGE_SIZE : false)
  const shown = loaded ? withLiveMessages(loaded, live, conversation.id, !hasMore) : []
  // Realtime can deliver the user's own message before the send request returns.
  const shownIds = new Set(shown.map((message) => message.id))
  const pendingHere = pending.filter(
    (message) => message.conversationId === conversation.id && !shownIds.has(message.id),
  )
  // Pending messages already shown; null until the first render has been committed, so
  // failed messages from before this list opened do not count as just written.
  const seenPendingRef = useRef<Set<string> | null>(null)
  const pendingIds = pendingHere.map((message) => message.id).join()
  const shownCount = shown.length + pendingHere.length
  // Changes when a pending message fails or is retried, which changes its height.
  const pendingStatuses = pendingHere.map((message) => message.status).join()
  const newest = loaded ? shown.at(-1) : undefined
  const openMarkerMicros = openMarker === null ? -Infinity : timestampMicros(openMarker)
  const firstUnreadId =
    openUnread > 0
      ? shown.find(
          (message) =>
            message.senderId !== currentUserId &&
            timestampMicros(message.createdAt) > openMarkerMicros,
        )?.id
      : undefined

  async function loadOlder() {
    const oldest = loaded?.[0]
    if (loadingOlderRef.current || !oldest || !hasMore) return
    // The newest page is kept with the older ones: a later reload of it moves on.
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
    const list = listRef.current
    if (list) anchorRef.current = { height: list.scrollHeight, top: list.scrollTop }
    setOlder((state) => ({
      messages: mergeMessages(result.data, state.messages, newestPage),
      hasMore: result.data.length >= MESSAGE_PAGE_SIZE,
      error: null,
    }))
  }

  // The user has seen the newest message when the list is at the bottom and the tab is
  // visible; everything up to it is then read.
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

  // An image that finishes loading grows its message; stay at the bottom if already there.
  function keepBottom() {
    if (stickRef.current) scrollToBottom()
  }

  // Older messages were added above: keep the messages on screen where they were.
  useLayoutEffect(() => {
    const list = listRef.current
    const anchor = anchorRef.current
    if (!list || !anchor) return
    anchorRef.current = null
    list.scrollTop = anchor.top + (list.scrollHeight - anchor.height)
  }, [older.messages.length])

  // Positions the list once after it loads: at the first unread message when there is
  // one (loading a few older pages to reach it), otherwise at the bottom.
  const position = useEffectEvent(() => {
    const list = listRef.current
    if (positionedRef.current || !loaded || !list) return
    if (openUnread > 0) {
      const oldest = loaded[0]
      const mayMissEarlierUnread =
        hasMore && (!oldest || timestampMicros(oldest.createdAt) > openMarkerMicros)
      // If an older page fails to load, the list is shown with what it has.
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
        markReadIfSeen()
        return
      }
    }
    positionedRef.current = true
    setPositioned(true)
    stickRef.current = true
    scrollToBottom()
    markReadIfSeen()
  })
  useLayoutEffect(() => {
    position()
  }, [latestData, older.messages.length, older.hasMore, older.error])

  // Keeps the newest message in view as messages are added or change, unless the user has
  // scrolled up to read older ones. A message the user just wrote always scrolls into view.
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

  // Messages that arrived while the tab was hidden are read once it is shown again.
  useEffect(() => {
    const handleVisibility = () => markReadFromEffect()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget
          const isAtBottom =
            list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_DISTANCE
          if (positionedRef.current) stickRef.current = isAtBottom
          if (isAtBottom !== atBottom) setAtBottom(isAtBottom)
          if (isAtBottom) markReadIfSeen()
          if (positionedRef.current && list.scrollTop < LOAD_OLDER_DISTANCE) void loadOlder()
        }}
        className="h-full overflow-y-auto px-4 py-4"
      >
        {latest.status === 'loading' && <LoadStatus status="loading" />}
        {latest.status === 'error' && (
          <LoadStatus status="error" error={latest.error} onRetry={latest.reload} />
        )}
        {loaded && loadingOlder && <LoadStatus status="loading" />}
        {loaded && !loadingOlder && older.error && (
          <LoadStatus status="error" error={older.error} onRetry={() => void loadOlder()} />
        )}
        {loaded && !loadingOlder && !older.error && hasMore && (
          <div className="mb-2 text-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              className="rounded-full px-3 py-1 text-sm text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              {t('chat.loadOlder')}
            </button>
          </div>
        )}
        {loaded && shownCount === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">{t('chat.noMessages')}</p>
        )}
        <ol className={`flex flex-col gap-2 ${positioned ? '' : 'invisible'}`}>
          {shown.map((message) => {
            const isMine = message.senderId === currentUserId
            const senderName =
              isGroup && !isMine ? findUser(users, message.senderId)?.displayName : undefined

            return (
              <Fragment key={message.id}>
                {message.id === firstUnreadId && (
                  <li
                    role="separator"
                    aria-label={t('chat.unreadDivider')}
                    className="my-2 flex items-center gap-3 text-xs font-medium text-brand-700 before:h-px before:flex-1 before:bg-brand-100 after:h-px after:flex-1 after:bg-brand-100"
                  >
                    {t('chat.unreadDivider')}
                  </li>
                )}
                <li
                  data-message-id={message.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`${BUBBLE_CLASS} ${isMine ? MINE_CLASS : 'rounded-bl-sm bg-slate-100'}`}
                  >
                    {senderName && (
                      <p className="mb-0.5 text-xs font-semibold text-brand-700">{senderName}</p>
                    )}
                    {message.attachment && message.kind !== 'text' && (
                      <AttachmentView
                        kind={message.kind}
                        attachment={message.attachment}
                        onLoad={keepBottom}
                      />
                    )}
                    {message.content && (
                      <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                    )}
                    <time
                      dateTime={message.createdAt}
                      className="mt-0.5 block text-right text-xs text-slate-500"
                    >
                      {formatTime(message.createdAt, language)}
                    </time>
                  </div>
                </li>
              </Fragment>
            )
          })}
          {pendingHere.map((message) => (
            <li key={message.id} className="flex justify-end">
              <div
                className={`${BUBBLE_CLASS} ${MINE_CLASS} ${
                  message.status === 'failed' ? 'ring-1 ring-red-300' : 'opacity-70'
                }`}
              >
                {message.upload && (
                  <AttachmentView
                    kind={message.upload.checked.kind}
                    attachment={{
                      path: message.upload.path,
                      name: message.upload.checked.name,
                      size: message.upload.checked.size,
                      mime: message.upload.checked.mime,
                    }}
                    pending
                    onLoad={keepBottom}
                  />
                )}
                {message.content && (
                  <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                )}
                {message.status === 'sending' ? (
                  <p role="status" className="mt-0.5 text-right text-xs text-slate-500">
                    {t(message.upload ? 'chat.uploading' : 'chat.sending')}
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
      {!atBottom && unreadCount > 0 && (
        <button
          type="button"
          onClick={() => {
            const list = listRef.current
            list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
          }}
          className="absolute right-4 bottom-4 rounded-full bg-brand-500 px-3 py-1.5 text-sm font-medium text-white shadow-md hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          {t('chat.newMessages', { count: unreadCount })} <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  )
}

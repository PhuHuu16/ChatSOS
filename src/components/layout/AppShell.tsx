import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/useAuth'
import {
  fetchConversationList,
  fetchMessages,
  markConversationRead,
} from '../../features/chat/api'
import {
  countUnread,
  laterReadMarker,
  sortByActivity,
  timestampMicros,
} from '../../features/chat/helpers'
import { useChatQuery } from '../../features/chat/useChatQuery'
import { useOutgoingMessages } from '../../features/chat/useOutgoingMessages'
import { useRealtimeMessages } from '../../features/chat/useRealtimeMessages'
import { NewChatDialog, type NewChatMode } from '../NewChatDialog'
import { ChatPanel } from './ChatPanel'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<NewChatMode | null>(null)
  const { session, signOut } = useAuth()
  // AppShell is only rendered for the signedIn status, so the session is present.
  const currentUserId = session?.user.id ?? ''
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  // Blocks a second click before the signingOut state has re-rendered the button.
  const signingOutRef = useRef(false)

  // Never rejects, so the `void` call below cannot leave an unhandled rejection. It never
  // navigates either: when the session was removed, the auth listener has already
  // reported signedOut and the route guard replaces this screen. When it is still there,
  // the status stays signedIn, the error is shown and the button can be used again.
  async function handleSignOut() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      const result = await signOut()
      if (!result.ok) setSignOutFailed(true)
    } catch {
      // signOut() reports failures in its result; this covers an unexpected throw.
      setSignOutFailed(true)
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

  const list = useChatQuery(currentUserId, fetchConversationList)
  const listData = list.status === 'ready' ? list.data : null
  const outgoing = useOutgoingMessages()
  const realtime = useRealtimeMessages(currentUserId, handleRealtimeLive)
  // Messages sent or received since the list loaded. They move their conversation up and
  // become its last message without reloading the list.
  const live = useMemo(
    () => [...outgoing.sent, ...realtime.received],
    [outgoing.sent, realtime.received],
  )
  const conversations = useMemo(
    () => sortByActivity(listData?.conversations ?? [], live),
    [listData, live],
  )
  const lastMessages = useMemo(() => [...(listData?.lastMessages ?? []), ...live], [listData, live])
  const users = listData?.users ?? []
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
  const messages = useChatQuery(selected?.id ?? null, fetchMessages)

  // Read markers set in this session, by conversation id. The loaded ones may be older.
  const [readMarkers, setReadMarkers] = useState<ReadonlyMap<string, string>>(new Map())
  const unreadCounts = useMemo(
    () =>
      countUnread(conversations, listData?.unread ?? [], live, currentUserId, readMarkers),
    [conversations, listData, live, currentUserId, readMarkers],
  )

  // The same markers, updated at once: scroll events can call handleRead several times
  // before the state above re-renders, and each marker should be sent only once.
  const sentMarkersRef = useRef(new Map<string, string>())

  // Called by the open chat with the newest message the user can see.
  function handleRead(conversationId: string, readAt: string) {
    const loadedMarker = conversations.find((item) => item.id === conversationId)?.lastReadAt
    const marker = laterReadMarker(loadedMarker, sentMarkersRef.current.get(conversationId))
    if (marker !== null && timestampMicros(readAt) <= timestampMicros(marker)) return
    sentMarkersRef.current.set(conversationId, readAt)
    setReadMarkers((markers) => new Map(markers).set(conversationId, readAt))
    // A failure only means the badge may come back after a reload; nothing to show.
    void markConversationRead(conversationId, currentUserId, readAt)
  }

  // Messages sent while Realtime was not subscribed are never delivered, so what is shown
  // is reloaded whenever the subscription (re)starts. Loaded data stays visible meanwhile.
  function handleRealtimeLive() {
    list.reload()
    messages.reload()
  }

  // Conversations, group members and their profiles are not sent by Realtime. A message
  // from a conversation or sender the list does not know (a chat someone just started
  // with this user, a new group member) reloads the list, once per unknown id.
  const reloadList = list.reload
  const requestedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!listData) return
    const knownConversations = new Set(listData.conversations.map((item) => item.id))
    const knownUsers = new Set(listData.users.map((user) => user.id))
    let reload = false
    for (const message of realtime.received) {
      const unknown = [
        knownConversations.has(message.conversationId) ? null : `c:${message.conversationId}`,
        knownUsers.has(message.senderId) ? null : `u:${message.senderId}`,
      ]
      for (const key of unknown) {
        if (key && !requestedRef.current.has(key)) {
          requestedRef.current.add(key)
          reload = true
        }
      }
    }
    if (reload) reloadList()
  }, [listData, realtime.received, reloadList])

  // The new chat opens as soon as the reloaded list contains it.
  function handleCreated(conversationId: string) {
    setDialog(null)
    setSelectedId(conversationId)
    list.reload()
  }

  // On small screens only one column is visible: the list, or the open chat.
  return (
    <div className="flex h-full flex-col">
      {realtime.status === 'interrupted' && (
        <p role="status" className="bg-amber-100 px-4 py-1 text-center text-sm text-amber-900">
          {t('chat.reconnecting')}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          className={`${selected ? 'hidden md:flex' : 'flex'} w-full border-r border-slate-200 md:w-80 md:shrink-0`}
        >
          <Sidebar
            list={list}
            conversations={conversations}
            lastMessages={lastMessages}
            unreadCounts={unreadCounts}
            users={users}
            currentUserId={currentUserId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNewChat={() => setDialog('direct')}
            onNewGroup={() => setDialog('group')}
            onSignOut={() => void handleSignOut()}
            signingOut={signingOut}
            signOutFailed={signOutFailed}
          />
        </div>
        <main className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1`}>
          <ChatPanel
            conversation={selected}
            messages={messages}
            live={live}
            pending={outgoing.pending}
            users={users}
            currentUserId={currentUserId}
            onBack={() => setSelectedId(null)}
            onSend={outgoing.send}
            onRetry={outgoing.retry}
            onDiscard={outgoing.discard}
            unreadCount={selected ? (unreadCounts.get(selected.id) ?? 0) : 0}
            onRead={handleRead}
          />
        </main>
      </div>
      {dialog && (
        <NewChatDialog
          mode={dialog}
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

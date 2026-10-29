import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/useAuth'
import {
  editMessage,
  fetchConversationList,
  fetchMessages,
  markConversationRead,
  recallMessage,
  type ChatResult,
} from '../../features/chat/api'
import type { ChatErrorKey } from '../../features/chat/chatErrors'
import {
  countUnread,
  laterReadMarker,
  sortByActivity,
  timestampMicros,
  withUpdate,
  withUpdates,
} from '../../features/chat/helpers'
import type { Message } from '../../features/chat/types'
import { useChatQuery } from '../../features/chat/useChatQuery'
import { clearAttachmentUrls, removeAttachment } from '../../features/chat/attachments'
import { useOutgoingMessages } from '../../features/chat/useOutgoingMessages'
import { readKey, useRealtimeMessages } from '../../features/chat/useRealtimeMessages'
import { clearAvatarUrls } from '../../features/profile/avatars'
import { fetchOwnProfile, type OwnProfile } from '../../features/profile/profileApi'
import { NewChatDialog, type NewChatMode } from '../NewChatDialog'
import { ProfileDialog } from '../ProfileDialog'
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
  // Edits and recalls made here, and the ones Realtime reported; the newer copy wins.
  const [ownChanges, setOwnChanges] = useState<ReadonlyMap<string, Message>>(new Map())
  const updates = useMemo(() => {
    let merged = realtime.updated
    for (const message of ownChanges.values()) merged = withUpdate(merged, message)
    return merged
  }, [realtime.updated, ownChanges])
  const lastMessages = useMemo(
    () => withUpdates([...(listData?.lastMessages ?? []), ...live], updates),
    [listData, live, updates],
  )
  // The user's own profile. A save or reload in the profile dialog replaces the loaded
  // copy at once, and the new name shows everywhere without reloading the list.
  const ownProfileQuery = useChatQuery(currentUserId, fetchOwnProfile)
  const [ownProfileUpdate, setOwnProfileUpdate] = useState<OwnProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const ownProfile =
    ownProfileUpdate ?? (ownProfileQuery.status === 'ready' ? ownProfileQuery.data : null)
  const users = useMemo(() => {
    const loaded = listData?.users ?? []
    if (!ownProfileUpdate) return loaded
    return loaded.map((user) =>
      user.id === ownProfileUpdate.id
        ? { ...user, displayName: ownProfileUpdate.displayName, avatarPath: ownProfileUpdate.avatarPath }
        : user,
    )
  }, [listData, ownProfileUpdate])
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
  const messages = useChatQuery(selected?.id ?? null, fetchMessages)

  // Read markers set in this session, by conversation id. The loaded ones may be older.
  const [readMarkers, setReadMarkers] = useState<ReadonlyMap<string, string>>(new Map())
  // The same, plus the ones Realtime reported (e.g. from the user's other tabs).
  const ownReadMarkers = useMemo(() => {
    const markers = new Map(readMarkers)
    for (const conversation of conversations) {
      const reported = realtime.memberReads.get(readKey(conversation.id, currentUserId))
      const marker = laterReadMarker(markers.get(conversation.id), reported)
      if (marker) markers.set(conversation.id, marker)
    }
    return markers
  }, [readMarkers, conversations, realtime.memberReads, currentUserId])
  const unreadCounts = useMemo(
    () =>
      countUnread(conversations, listData?.unread ?? [], live, currentUserId, ownReadMarkers),
    [conversations, listData, live, currentUserId, ownReadMarkers],
  )
  // The other members' read markers in the open conversation, by user id.
  const othersRead = useMemo(() => {
    const markers = new Map<string, string | null>()
    for (const userId of selected?.memberIds ?? []) {
      if (userId === currentUserId || !selected) continue
      const reported = realtime.memberReads.get(readKey(selected.id, userId))
      markers.set(userId, laterReadMarker(selected.memberReadAt[userId], reported))
    }
    return markers
  }, [selected, realtime.memberReads, currentUserId])

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

  async function changeMessage(request: Promise<ChatResult<Message>>): Promise<ChatErrorKey | null> {
    const result = await request.catch(
      (): ChatResult<Message> => ({ ok: false, error: 'chat.errors.changeFailed' }),
    )
    if (!result.ok) return result.error
    setOwnChanges((map) => withUpdate(map, result.data))
    return null
  }

  function handleEdit(message: Message, content: string) {
    return changeMessage(editMessage(message.id, content))
  }

  // A recalled image or file is removed from storage too; no message uses it any more.
  async function handleRecall(message: Message) {
    const error = await changeMessage(recallMessage(message.id))
    if (!error && message.attachment) void removeAttachment(message.attachment.path)
    return error
  }

  // Messages sent while Realtime was not subscribed are never delivered, so what is shown
  // is reloaded whenever the subscription (re)starts. Loaded data stays visible meanwhile.
  function handleRealtimeLive() {
    list.reload()
    messages.reload()
  }

  // A file dropped on the page would make the browser open it and leave the app. The
  // open chat's composer picks dropped files up itself.
  useEffect(() => {
    const keepFiles = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    document.addEventListener('dragover', keepFiles)
    document.addEventListener('drop', keepFiles)
    return () => {
      document.removeEventListener('dragover', keepFiles)
      document.removeEventListener('drop', keepFiles)
      // Signed URLs work for anyone who has them; forget them when the user leaves.
      clearAttachmentUrls()
      clearAvatarUrls()
    }
  }, [])

  // Conversations and profiles are not sent by Realtime. A message or a membership in a
  // conversation, or from a user, the list does not know (a chat someone just started
  // with this user, a new group member) reloads the list, once per unknown id.
  const reloadList = list.reload
  const requestedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!listData) return
    const knownConversations = new Set(listData.conversations.map((item) => item.id))
    const knownUsers = new Set(listData.users.map((user) => user.id))
    let reload = false
    const seen = [
      ...realtime.received.map((message) => ({
        conversationId: message.conversationId,
        userId: message.senderId,
      })),
      // A new chat with this user, or a new member in one of their groups.
      ...realtime.joined,
    ]
    for (const { conversationId, userId } of seen) {
      const unknown = [
        knownConversations.has(conversationId) ? null : `c:${conversationId}`,
        knownUsers.has(userId) ? null : `u:${userId}`,
      ]
      for (const key of unknown) {
        if (key && !requestedRef.current.has(key)) {
          requestedRef.current.add(key)
          reload = true
        }
      }
    }
    if (reload) reloadList()
  }, [listData, realtime.received, realtime.joined, reloadList])

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
            profile={ownProfile}
            profileFailed={ownProfileQuery.status === 'error'}
            onRetryProfile={ownProfileQuery.reload}
            onOpenProfile={() => setProfileOpen(true)}
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
            onSendFile={outgoing.sendFile}
            onRetry={outgoing.retry}
            onDiscard={outgoing.discard}
            unreadCount={selected ? (unreadCounts.get(selected.id) ?? 0) : 0}
            readMarker={
              selected ? laterReadMarker(selected.lastReadAt, ownReadMarkers.get(selected.id)) : null
            }
            othersRead={othersRead}
            onRead={handleRead}
            updates={updates}
            onEdit={handleEdit}
            onRecall={handleRecall}
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
      {profileOpen && ownProfile && (
        <ProfileDialog
          currentUserId={currentUserId}
          profile={ownProfile}
          onClose={() => setProfileOpen(false)}
          onProfileUpdated={setOwnProfileUpdate}
        />
      )}
    </div>
  )
}

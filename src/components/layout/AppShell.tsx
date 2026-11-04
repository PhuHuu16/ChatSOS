import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/useAuth'
import {
  clearConversation,
  editMessage,
  fetchConversationList,
  fetchMessages,
  hideMessages,
  markConversationRead,
  recallMessage,
  recallMessages,
  type ChatResult,
} from '../../features/chat/api'
import type { ChatErrorKey } from '../../features/chat/chatErrors'
import {
  afterClear,
  clearMarks,
  countUnread,
  getConversationTitle,
  isListed,
  laterReadMarker,
  sortByActivity,
  timestampMicros,
  unknownUserIds,
  withoutHidden,
  withUpdate,
  withUpdates,
} from '../../features/chat/helpers'
import type { Conversation, Message } from '../../features/chat/types'
import { useChatQuery, type ChatQueryState } from '../../features/chat/useChatQuery'
import { useExtraUsers } from '../../features/chat/useExtraUsers'
import { clearAttachmentUrls, removeAttachment } from '../../features/chat/attachments'
import { useOutgoingMessages } from '../../features/chat/useOutgoingMessages'
import { readKey, useRealtimeMessages } from '../../features/chat/useRealtimeMessages'
import { clearAvatarUrls } from '../../features/profile/avatars'
import { fetchOwnProfile, type OwnProfile } from '../../features/profile/profileApi'
import { DeleteConversationDialog } from '../DeleteConversationDialog'
import { GroupInfoDialog } from '../GroupInfoDialog'
import { NewChatDialog, type NewChatMode } from '../NewChatDialog'
import { ProfileDialog } from '../ProfileDialog'
import { ChatPanel } from './ChatPanel'
import { Sidebar } from './Sidebar'

// Khung chính
export function AppShell() {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<NewChatMode | null>(null)
  const { session, signOut } = useAuth()
  const currentUserId = session?.user.id ?? ''
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const signingOutRef = useRef(false)

  async function handleSignOut() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      const result = await signOut()
      if (!result.ok) setSignOutFailed(true)
    } catch {
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
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [sessionClears, setSessionClears] = useState<ReadonlyMap<string, string>>(new Map())
  const clears = useMemo(() => {
    const marks = new Map(sessionClears)
    for (const [conversationId, removedAt] of realtime.removedAt) {
      const mark = laterReadMarker(marks.get(conversationId), removedAt)
      if (mark) marks.set(conversationId, mark)
    }
    return clearMarks(listData?.conversations ?? [], marks)
  }, [listData, sessionClears, realtime.removedAt])
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  const live = useMemo(
    () => afterClear(withoutHidden([...outgoing.sent, ...realtime.received], hidden), clears),
    [outgoing.sent, realtime.received, hidden, clears],
  )
  const [ownChanges, setOwnChanges] = useState<ReadonlyMap<string, Message>>(new Map())
  const updates = useMemo(() => {
    let merged = realtime.updated
    for (const message of ownChanges.values()) merged = withUpdate(merged, message)
    return merged
  }, [realtime.updated, ownChanges])
  const lastMessages = useMemo(
    () =>
      withUpdates(
        afterClear(withoutHidden([...(listData?.lastMessages ?? []), ...live], hidden), clears),
        updates,
      ),
    [listData, live, updates, hidden, clears],
  )
  const conversations = useMemo(
    () =>
      sortByActivity(
        (listData?.conversations ?? []).filter(
          (item) =>
            !realtime.removed.has(item.id) &&
            (item.id === selectedId || isListed(item, clears, lastMessages)),
        ),
        live,
      ),
    [listData, live, clears, lastMessages, selectedId, realtime.removed],
  )
  const ownProfileQuery = useChatQuery(currentUserId, fetchOwnProfile)
  const [ownProfileUpdate, setOwnProfileUpdate] = useState<OwnProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const ownProfile =
    ownProfileUpdate ?? (ownProfileQuery.status === 'ready' ? ownProfileQuery.data : null)
  const extraUsers = useExtraUsers()
  const users = useMemo(() => {
    const listed = listData?.users ?? []
    const listedIds = new Set(listed.map((user) => user.id))
    const loaded = [...listed, ...extraUsers.users.filter((user) => !listedIds.has(user.id))]
    if (!ownProfileUpdate) return loaded
    return loaded.map((user) =>
      user.id === ownProfileUpdate.id
        ? { ...user, displayName: ownProfileUpdate.displayName, avatarPath: ownProfileUpdate.avatarPath }
        : user,
    )
  }, [listData, ownProfileUpdate, extraUsers.users])
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
  const [groupInfoFor, setGroupInfoFor] = useState<string | null>(null)
  if (groupInfoFor !== null && selected?.id !== groupInfoFor) setGroupInfoFor(null)
  const groupInfo = groupInfoFor !== null && selected?.type === 'group' ? selected : null
  const messagesQuery = useChatQuery(selected?.id ?? null, fetchMessages)
  const loadedPage = messagesQuery.status === 'ready' ? messagesQuery.data : null
  const shownPage = useMemo(
    () => (loadedPage ? afterClear(loadedPage, clears) : null),
    [loadedPage, clears],
  )
  const messages: ChatQueryState<Message[]> =
    messagesQuery.status === 'ready' && shownPage
      ? { ...messagesQuery, data: shownPage }
      : messagesQuery

  const [readMarkers, setReadMarkers] = useState<ReadonlyMap<string, string>>(new Map())
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
      countUnread(
        conversations,
        afterClear(withoutHidden(listData?.unread ?? [], hidden), clears),
        live,
        currentUserId,
        ownReadMarkers,
      ),
    [conversations, listData, live, currentUserId, ownReadMarkers, hidden, clears],
  )
  const othersRead = useMemo(() => {
    const markers = new Map<string, string | null>()
    for (const userId of selected?.memberIds ?? []) {
      if (userId === currentUserId || !selected) continue
      const reported = realtime.memberReads.get(readKey(selected.id, userId))
      markers.set(userId, laterReadMarker(selected.memberReadAt[userId], reported))
    }
    return markers
  }, [selected, realtime.memberReads, currentUserId])

  const sentMarkersRef = useRef(new Map<string, string>())

  function handleRead(conversationId: string, readAt: string) {
    const loadedMarker = conversations.find((item) => item.id === conversationId)?.lastReadAt
    const marker = laterReadMarker(loadedMarker, sentMarkersRef.current.get(conversationId))
    if (marker !== null && timestampMicros(readAt) <= timestampMicros(marker)) return
    sentMarkersRef.current.set(conversationId, readAt)
    setReadMarkers((markers) => new Map(markers).set(conversationId, readAt))
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

  async function handleRecall(message: Message) {
    const error = await changeMessage(recallMessage(message.id))
    if (!error && message.attachment) void removeAttachment(message.attachment.path)
    return error
  }

  async function handleHideMessages(messages: Message[]): Promise<ChatErrorKey | null> {
    const result = await hideMessages(messages.map((message) => message.id)).catch(
      (): ChatResult<null> => ({ ok: false, error: 'chat.errors.deleteFailed' }),
    )
    if (!result.ok) return result.error
    setHidden((current) => {
      const next = new Set(current)
      for (const message of messages) next.add(message.id)
      return next
    })
    list.reload()
    return null
  }

  async function handleRecallMessages(messages: Message[]): Promise<ChatErrorKey | null> {
    const result = await recallMessages(messages.map((message) => message.id)).catch(
      (): ChatResult<Message[]> => ({ ok: false, error: 'chat.errors.changeFailed' }),
    )
    if (!result.ok) return result.error
    setOwnChanges((map) => result.data.reduce(withUpdate, map))
    const recalled = new Set(
      result.data.filter((message) => message.deletedAt !== null).map((message) => message.id),
    )
    for (const message of messages) {
      if (message.attachment && recalled.has(message.id)) {
        void removeAttachment(message.attachment.path)
      }
    }
    return recalled.size === messages.length ? null : 'chat.errors.recallPartial'
  }

  async function handleClearConversation(conversation: Conversation): Promise<ChatErrorKey | null> {
    const result = await clearConversation(conversation.id).catch(
      (): ChatResult<string> => ({ ok: false, error: 'chat.errors.deleteConversationFailed' }),
    )
    if (!result.ok) return result.error
    const mark = result.data
    setSessionClears((current) => new Map(current).set(conversation.id, mark))
    setSelectedId((current) => (current === conversation.id ? null : current))
    return null
  }

  function handleRealtimeLive() {
    list.reload()
    messages.reload()
  }

  useEffect(() => {
    const keepFiles = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    document.addEventListener('dragover', keepFiles)
    document.addEventListener('drop', keepFiles)
    return () => {
      document.removeEventListener('dragover', keepFiles)
      document.removeEventListener('drop', keepFiles)
      clearAttachmentUrls()
      clearAvatarUrls()
    }
  }, [])

  const reloadList = list.reload
  const requestedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!listData) return
    const knownConversations = new Set(listData.conversations.map((item) => item.id))
    const knownUsers = new Set(listData.users.map((user) => user.id))
    let reload = false
    for (const message of realtime.received) {
      const key = `m:${message.id}`
      if (message.system && !requestedRef.current.has(key)) {
        requestedRef.current.add(key)
        reload = true
      }
    }
    for (const conversationId of realtime.removed) {
      const key = `r:${conversationId}`
      if (!requestedRef.current.has(key)) {
        requestedRef.current.add(key)
        reload = true
      }
    }
    realtime.joined.forEach((member, index) => {
      const key = `j:${index}`
      if (member.userId === currentUserId && !requestedRef.current.has(key)) {
        requestedRef.current.add(key)
        reload = true
      }
    })
    const seen = [
      ...realtime.received.map((message) => ({
        conversationId: message.conversationId,
        userId: message.senderId,
      })),
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
  }, [listData, realtime.received, realtime.joined, realtime.removed, reloadList, currentUserId])

  const requestUsers = extraUsers.request
  useEffect(() => {
    const ids = unknownUserIds(lastMessages, users)
    if (ids.length > 0) requestUsers(ids)
  }, [lastMessages, users, requestUsers])

  function handleLeftGroup(conversationId: string) {
    realtime.markRemoved(conversationId)
    setSelectedId((current) => (current === conversationId ? null : current))
    list.reload()
  }

  function handleCreated(conversationId: string) {
    setDialog(null)
    setSelectedId(conversationId)
    list.reload()
  }

  return (
    <div className="flex h-full flex-col">
      {realtime.status === 'interrupted' && (
        <p role="status" className="border-b border-line bg-warning-soft px-4 py-1 text-center text-sm text-warning">
          {t('chat.reconnecting')}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-75 md:shrink-0`}
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
            onDeleteConversation={setDeleteTarget}
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
            hidden={hidden}
            onHideMessages={handleHideMessages}
            onRecallMessages={handleRecallMessages}
            onOpenGroupInfo={() => setGroupInfoFor(selected?.id ?? null)}
            onUnknownUsers={extraUsers.request}
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
      {deleteTarget && (
        <DeleteConversationDialog
          title={getConversationTitle(deleteTarget, users, currentUserId)}
          onConfirm={() => handleClearConversation(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          onDone={() => setDeleteTarget(null)}
        />
      )}
      {groupInfo && (
        <GroupInfoDialog
          key={groupInfo.id}
          conversation={groupInfo}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setGroupInfoFor(null)}
          onChanged={list.reload}
          onLeft={() => handleLeftGroup(groupInfo.id)}
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

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
  // Messages the user deleted for themselves in this session. The server leaves them out
  // of every later load; until then they are left out here.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  // Conversations whose history the user deleted for themselves in this session, with the
  // server's mark. Together with the loaded marks they hide the older messages still in
  // memory; the server leaves those out of every later load.
  const [sessionClears, setSessionClears] = useState<ReadonlyMap<string, string>>(new Map())
  // A group the user was removed from or left counts the same way from the removal on:
  // added back, they see only what came after it, as the server already does.
  const clears = useMemo(() => {
    const marks = new Map(sessionClears)
    for (const [conversationId, removedAt] of realtime.removedAt) {
      const mark = laterReadMarker(marks.get(conversationId), removedAt)
      if (mark) marks.set(conversationId, mark)
    }
    return clearMarks(listData?.conversations ?? [], marks)
  }, [listData, sessionClears, realtime.removedAt])
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  // Messages sent or received since the list loaded. They move their conversation up and
  // become its last message without reloading the list.
  const live = useMemo(
    () => afterClear(withoutHidden([...outgoing.sent, ...realtime.received], hidden), clears),
    [outgoing.sent, realtime.received, hidden, clears],
  )
  // Edits and recalls made here, and the ones Realtime reported; the newer copy wins.
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
  // A conversation whose history the user deleted leaves the list until a new message
  // arrives. The open one stays (e.g. reopened through "New chat"). A group the user was
  // removed from or left leaves at once, even before the list reloads without it.
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
  // The user's own profile. A save or reload in the profile dialog replaces the loaded
  // copy at once, and the new name shows everywhere without reloading the list.
  const ownProfileQuery = useChatQuery(currentUserId, fetchOwnProfile)
  const [ownProfileUpdate, setOwnProfileUpdate] = useState<OwnProfile | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const ownProfile =
    ownProfileUpdate ?? (ownProfileQuery.status === 'ready' ? ownProfileQuery.data : null)
  // Profiles of people the loaded list does not include, e.g. who left a group.
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
  // The group whose info dialog is open: always the open conversation. It closes when the
  // user opens another conversation or the group leaves the list (removed, left).
  const [groupInfoFor, setGroupInfoFor] = useState<string | null>(null)
  if (groupInfoFor !== null && selected?.id !== groupInfoFor) setGroupInfoFor(null)
  const groupInfo = groupInfoFor !== null && selected?.type === 'group' ? selected : null
  const messagesQuery = useChatQuery(selected?.id ?? null, fetchMessages)
  // A page loaded before the history was deleted can show again for a moment when the
  // conversation is reopened, until it reloads: leave its older messages out. Memoized so
  // the open chat gets the same array until something changes.
  const loadedPage = messagesQuery.status === 'ready' ? messagesQuery.data : null
  const shownPage = useMemo(
    () => (loadedPage ? afterClear(loadedPage, clears) : null),
    [loadedPage, clears],
  )
  const messages: ChatQueryState<Message[]> =
    messagesQuery.status === 'ready' && shownPage
      ? { ...messagesQuery, data: shownPage }
      : messagesQuery

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
      countUnread(
        conversations,
        afterClear(withoutHidden(listData?.unread ?? [], hidden), clears),
        live,
        currentUserId,
        ownReadMarkers,
      ),
    [conversations, listData, live, currentUserId, ownReadMarkers, hidden, clears],
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

  // Delete for me. On success the messages disappear here at once; the list is reloaded
  // so each conversation's last message and unread count come from the server again.
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

  // Recall for everyone. Only the messages the server reports as recalled are updated, and
  // only their images and files are removed from storage.
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

  // Deletes a conversation's history for the user only; other members keep it. It leaves
  // the list (and closes, if open) until a new message arrives.
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
    // A member was added, removed or left, the owner or the title changed: reload once
    // per system message, to show the new members, owner and title.
    for (const message of realtime.received) {
      const key = `m:${message.id}`
      if (message.system && !requestedRef.current.has(key)) {
        requestedRef.current.add(key)
        reload = true
      }
    }
    // The user was removed from (or left) a group: the list reloads without it.
    for (const conversationId of realtime.removed) {
      const key = `r:${conversationId}`
      if (!requestedRef.current.has(key)) {
        requestedRef.current.add(key)
        reload = true
      }
    }
    // The user joined a conversation, maybe one the list knew before they were removed:
    // reload once per join (`joined` only grows, so the index identifies it).
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
  }, [listData, realtime.received, realtime.joined, realtime.removed, reloadList, currentUserId])

  // Names for the senders and system lines of the last messages, when not members.
  const requestUsers = extraUsers.request
  useEffect(() => {
    const ids = unknownUserIds(lastMessages, users)
    if (ids.length > 0) requestUsers(ids)
  }, [lastMessages, users, requestUsers])

  // The user left the group in the dialog: it leaves the list at once.
  function handleLeftGroup(conversationId: string) {
    realtime.markRemoved(conversationId)
    setSelectedId((current) => (current === conversationId ? null : current))
    list.reload()
  }

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

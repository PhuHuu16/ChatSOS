import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MESSAGE_SELECT_LIMIT } from '../../features/chat/api'
import type { CheckedFile } from '../../features/chat/attachments'
import type { ChatErrorKey } from '../../features/chat/chatErrors'
import {
  findUser,
  getConversationAvatarPath,
  getConversationTitle,
  withUpdates,
} from '../../features/chat/helpers'
import type { Conversation, Message, User } from '../../features/chat/types'
import type { ChatQueryState } from '../../features/chat/useChatQuery'
import type { PendingMessage } from '../../features/chat/useOutgoingMessages'
import { useTyping } from '../../features/chat/useTyping'
import { Avatar } from '../Avatar'
import { Composer } from '../Composer'
import { DeleteMessagesDialog } from '../DeleteMessagesDialog'
import { ICON_PROPS } from '../iconProps'
import { MessageList } from './MessageList'

const ICON_BUTTON =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

interface ChatPanelProps {
  conversation: Conversation | null
  // The newest page of `conversation`'s messages, oldest first.
  messages: ChatQueryState<Message[]>
  // Messages sent or received since the chat screen opened, of every conversation.
  live: Message[]
  pending: PendingMessage[]
  users: User[]
  currentUserId: string
  onBack: () => void
  onSend: (conversationId: string, content: string) => void
  onSendFile: (conversationId: string, file: Blob, checked: CheckedFile) => void
  onRetry: (message: PendingMessage) => void
  onDiscard: (message: PendingMessage) => void
  // The newest copy of each message edited or recalled since the chat screen opened.
  updates: ReadonlyMap<string, Message>
  // Resolve to null on success, or the error to show.
  onEdit: (message: Message, content: string) => Promise<ChatErrorKey | null>
  onRecall: (message: Message) => Promise<ChatErrorKey | null>
  // Messages the user deleted for themselves in this session.
  hidden: ReadonlySet<string>
  // Delete for me, and recall for everyone, several messages at once. Resolve to null on
  // success, or the error to show.
  onHideMessages: (messages: Message[]) => Promise<ChatErrorKey | null>
  onRecallMessages: (messages: Message[]) => Promise<ChatErrorKey | null>
  // Unread messages in `conversation`.
  unreadCount: number
  // The user's read marker for `conversation` (ISO 8601), or null when none is read.
  readMarker: string | null
  // The user has seen the conversation up to the message created at `readAt`.
  onRead: (conversationId: string, readAt: string) => void
  // The other members' read markers in `conversation`, by user id.
  othersRead: ReadonlyMap<string, string | null>
  // Opens the group info dialog (groups only).
  onOpenGroupInfo: () => void
  // Ids of people the shown messages name but `users` does not know.
  onUnknownUsers: (ids: string[]) => void
}

export function ChatPanel({
  conversation,
  messages,
  live,
  pending,
  users,
  currentUserId,
  onBack,
  onSend,
  onSendFile,
  onRetry,
  onDiscard,
  unreadCount,
  readMarker,
  onRead,
  othersRead,
  updates,
  onEdit,
  onRecall,
  hidden,
  onHideMessages,
  onRecallMessages,
  onOpenGroupInfo,
  onUnknownUsers,
}: ChatPanelProps) {
  const { t } = useTranslation()
  const typing = useTyping(conversation?.id ?? null, currentUserId, conversation?.memberIds ?? [])
  const typingNames = typing.typingUserIds
    .map((id) => findUser(users, id)?.displayName)
    .filter((name): name is string => Boolean(name))
  // The message being edited in the composer.
  const [editing, setEditing] = useState<Message | null>(null)
  // The message whose edit or recall is waiting for the server.
  const [changingId, setChangingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{
    conversationId: string
    error: ChatErrorKey
  } | null>(null)
  // The selected messages, by id, while selecting; and whether the delete dialog is open.
  const [selection, setSelection] = useState<{
    conversationId: string
    messages: ReadonlyMap<string, Message>
  } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Both belong to one conversation and are dropped when another one is opened.
  const editingHere = editing && editing.conversationId === conversation?.id ? editing : null
  const errorHere =
    actionError && actionError.conversationId === conversation?.id ? actionError.error : null
  // Selecting ends when another conversation is opened (state adjusted during render, so
  // nothing of it is ever shown with the wrong conversation).
  if (selection && selection.conversationId !== conversation?.id) {
    setSelection(null)
    setDeleteOpen(false)
  }
  const selected = selection && selection.conversationId === conversation?.id ? selection.messages : null
  const selectedIds = useMemo(() => (selected ? new Set(selected.keys()) : null), [selected])

  function startEdit(message: Message) {
    setActionError(null)
    setEditing(message)
  }

  // Starts selecting with `message`, or adds or removes it (up to MESSAGE_SELECT_LIMIT).
  function toggleSelect(message: Message) {
    setActionError(null)
    setEditing(null)
    setSelection((current) => {
      const messages = new Map(
        current && current.conversationId === message.conversationId ? current.messages : [],
      )
      if (messages.has(message.id)) messages.delete(message.id)
      else if (messages.size < MESSAGE_SELECT_LIMIT) messages.set(message.id, message)
      return { conversationId: message.conversationId, messages }
    })
  }

  function endSelection() {
    setDeleteOpen(false)
    setSelection(null)
  }

  // Escape ends selecting; while the dialog is open, Escape closes only the dialog.
  const selecting = selected !== null
  useEffect(() => {
    if (!selecting || deleteOpen) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelection(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [selecting, deleteOpen])

  // The selected messages in their newest known version (e.g. recalled meanwhile).
  const selectedMessages = selected ? withUpdates([...selected.values()], updates) : []

  async function saveEdit(message: Message, content: string) {
    // Nothing changed: nothing to save.
    if (content === message.content) {
      setEditing(null)
      return
    }
    setActionError(null)
    setChangingId(message.id)
    const error = await onEdit(message, content)
    setChangingId(null)
    if (error) setActionError({ conversationId: message.conversationId, error })
    else setEditing(null)
  }

  async function recall(message: Message) {
    if (!window.confirm(t('chat.recallConfirm'))) return
    setActionError(null)
    setChangingId(message.id)
    const error = await onRecall(message)
    setChangingId(null)
    if (error) {
      setActionError({ conversationId: message.conversationId, error })
    } else if (editing?.id === message.id) {
      setEditing(null)
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas p-6">
        <p className="rounded-full bg-subtle px-4 py-2 text-sm text-muted">
          {t('chat.emptyState')}
        </p>
      </div>
    )
  }

  const title = getConversationTitle(conversation, users, currentUserId)

  return (
    <div className="flex h-full w-full flex-col bg-canvas text-fg">
      <header className="flex h-15 shrink-0 items-center gap-3 border-b border-line pr-3 pl-4 md:pl-5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('chat.back')}
          title={t('chat.back')}
          className={`-ml-2 md:hidden ${ICON_BUTTON}`}
        >
          <svg {...ICON_PROPS} width={20} height={20} strokeWidth={2}>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <Avatar
          id={conversation.id}
          name={title}
          avatarPath={getConversationAvatarPath(conversation, users, currentUserId)}
          size="sm"
          shape={conversation.type === 'group' ? 'square' : 'circle'}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted">
            {conversation.type === 'group'
              ? t('chat.members', { count: conversation.memberIds.length })
              : t('chat.direct')}
          </p>
        </div>
        {conversation.type === 'group' && (
          <button
            type="button"
            onClick={onOpenGroupInfo}
            aria-label={t('chat.groupInfo')}
            title={t('chat.groupInfo')}
            className={ICON_BUTTON}
          >
            <svg {...ICON_PROPS}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5" />
              <path d="M12 7.5v.5" />
            </svg>
          </button>
        )}
      </header>

      <MessageList
        key={`messages:${conversation.id}`}
        conversation={conversation}
        latest={messages}
        live={live}
        pending={pending}
        users={users}
        currentUserId={currentUserId}
        unreadCount={unreadCount}
        readMarker={readMarker}
        othersRead={othersRead}
        typingNames={typingNames}
        updates={updates}
        editingId={editingHere?.id ?? null}
        changingId={changingId}
        onStartEdit={startEdit}
        onRecall={(message) => void recall(message)}
        hidden={hidden}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onRetry={onRetry}
        onDiscard={onDiscard}
        onRead={onRead}
        onUnknownUsers={onUnknownUsers}
      />

      {errorHere && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-t border-line bg-danger-soft px-4 py-2 text-sm text-danger"
        >
          <p>{t(errorHere)}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={t('chat.dismiss')}
            className="rounded px-1 text-lg leading-none hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      {selected && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <p role="status" className="min-w-0 flex-1 text-sm">
            {t('chat.selection.count', { count: selected.size })}
            {selected.size >= MESSAGE_SELECT_LIMIT && (
              <span className="block text-xs text-muted">
                {t('chat.selection.limit', { max: MESSAGE_SELECT_LIMIT })}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            disabled={selected.size === 0}
            className="rounded-lg bg-danger-solid px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('chat.selection.delete')}
          </button>
          <button
            type="button"
            onClick={endSelection}
            className="rounded-lg px-4 py-2 text-sm font-medium text-fg hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t('chat.selection.cancel')}
          </button>
        </div>
      )}

      {/* Only hidden while selecting, so a half-written message is kept. */}
      <div hidden={selected !== null}>
        <Composer
          key={`composer:${conversation.id}:${editingHere?.id ?? ''}`}
          onSend={(content) => onSend(conversation.id, content)}
          onSendFile={(file, checked) => onSendFile(conversation.id, file, checked)}
          onTyping={typing.setTyping}
          editing={
            editingHere && {
              content: editingHere.content,
              saving: changingId === editingHere.id,
              onSave: (content) => void saveEdit(editingHere, content),
              onCancel: () => setEditing(null),
            }
          }
        />
      </div>

      {deleteOpen && selected && (
        <DeleteMessagesDialog
          messages={selectedMessages}
          currentUserId={currentUserId}
          onHide={() => onHideMessages(selectedMessages)}
          onRecall={() => onRecallMessages(selectedMessages)}
          onClose={() => setDeleteOpen(false)}
          onDone={endSelection}
        />
      )}
    </div>
  )
}

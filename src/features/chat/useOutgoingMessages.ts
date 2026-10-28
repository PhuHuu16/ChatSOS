import { useCallback, useState } from 'react'
import { sendTextMessage, type ChatResult } from './api'
import {
  newAttachmentPath,
  sendAttachment,
  setLocalAttachmentUrl,
  type CheckedFile,
} from './attachments'
import type { ChatErrorKey } from './chatErrors'
import type { Message } from './types'

// A file being sent. The path is chosen once, so a retry reuses the uploaded file.
export interface PendingUpload {
  file: Blob
  checked: CheckedFile
  path: string
}

// A message the server has not confirmed yet.
export interface PendingMessage {
  id: string
  conversationId: string
  // Text, already checked with checkTextMessage; empty for a file.
  content: string
  upload: PendingUpload | null
  // Client clock; only used to show a time until the server confirms the message.
  createdAt: string
  status: 'sending' | 'failed'
  error: ChatErrorKey | null
}

export interface OutgoingMessages {
  // Waiting for the server or failed, in the order they were written.
  pending: PendingMessage[]
  // Confirmed by the server since the chat screen opened.
  sent: Message[]
  send: (conversationId: string, content: string) => void
  sendFile: (conversationId: string, file: Blob, checked: CheckedFile) => void
  retry: (message: PendingMessage) => void
  discard: (id: string) => void
}

// Messages written in this session. Each one shows at once as pending and moves to `sent`
// when the server confirms it. A failed one stays until it is retried or discarded.
export function useOutgoingMessages(): OutgoingMessages {
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [sent, setSent] = useState<Message[]>([])

  const deliver = useCallback((message: PendingMessage) => {
    const { upload } = message
    const request = upload
      ? sendAttachment(message.conversationId, upload.file, upload.checked, upload.path, message.id)
      : sendTextMessage(message.conversationId, message.content, message.id)
    void request
      .catch((): ChatResult<Message> => ({ ok: false, error: 'chat.errors.sendFailed' }))
      .then((result) => {
        if (result.ok) {
          setPending((list) => list.filter((item) => item.id !== message.id))
          // A double retry can confirm the same message twice.
          setSent((list) =>
            list.some((item) => item.id === result.data.id) ? list : [...list, result.data],
          )
        } else {
          setPending((list) =>
            list.map((item) =>
              item.id === message.id ? { ...item, status: 'failed', error: result.error } : item,
            ),
          )
        }
      })
  }, [])

  const add = useCallback(
    (conversationId: string, content: string, upload: PendingUpload | null) => {
      const message: PendingMessage = {
        id: crypto.randomUUID(),
        conversationId,
        content,
        upload,
        createdAt: new Date().toISOString(),
        status: 'sending',
        error: null,
      }
      setPending((list) => [...list, message])
      deliver(message)
    },
    [deliver],
  )

  const send = useCallback(
    (conversationId: string, content: string) => add(conversationId, content, null),
    [add],
  )

  const sendFile = useCallback(
    (conversationId: string, file: Blob, checked: CheckedFile) => {
      const path = newAttachmentPath(conversationId, checked.extension)
      // The picked image shows at once, and stays in memory once sent.
      if (checked.kind === 'image') setLocalAttachmentUrl(path, file)
      add(conversationId, '', { file, checked, path })
    },
    [add],
  )

  // Same id as the first attempt, so a message that did reach the server is not stored twice.
  const retry = useCallback(
    (message: PendingMessage) => {
      if (message.status !== 'failed') return
      setPending((list) =>
        list.map((item) =>
          item.id === message.id ? { ...item, status: 'sending', error: null } : item,
        ),
      )
      deliver(message)
    },
    [deliver],
  )

  const discard = useCallback((id: string) => {
    setPending((list) => list.filter((item) => item.id !== id || item.status !== 'failed'))
  }, [])

  return { pending, sent, send, sendFile, retry, discard }
}

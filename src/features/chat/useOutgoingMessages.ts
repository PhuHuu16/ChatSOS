import { useCallback, useState } from 'react'
import { sendTextMessage, type ChatResult } from './api'
import {
  newAttachmentPath,
  removeAttachment,
  sendAttachment,
  setLocalAttachmentUrl,
  type CheckedFile,
} from './attachments'
import type { ChatErrorKey } from './chatErrors'
import type { Message } from './types'

export interface PendingUpload {
  file: Blob
  checked: CheckedFile
  path: string
}

export interface PendingMessage {
  id: string
  conversationId: string
  content: string
  upload: PendingUpload | null
  createdAt: string
  status: 'sending' | 'failed'
  error: ChatErrorKey | null
}

export interface OutgoingMessages {
  pending: PendingMessage[]
  sent: Message[]
  send: (conversationId: string, content: string) => void
  sendFile: (conversationId: string, file: Blob, checked: CheckedFile) => void
  retry: (message: PendingMessage) => void
  discard: (message: PendingMessage) => void
}

// Hàng đợi tin đang gửi
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
      if (checked.kind === 'image') setLocalAttachmentUrl(path, file)
      add(conversationId, '', { file, checked, path })
    },
    [add],
  )

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

  const discard = useCallback((message: PendingMessage) => {
    if (message.status !== 'failed') return
    setPending((list) => list.filter((item) => item.id !== message.id))
    if (message.upload) void removeAttachment(message.upload.path)
  }, [])

  return { pending, sent, send, sendFile, retry, discard }
}

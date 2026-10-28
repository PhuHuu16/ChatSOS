import { useCallback, useState } from 'react'
import { sendTextMessage, type ChatResult } from './api'
import type { ChatErrorKey } from './chatErrors'
import type { Message } from './types'

// A text message the server has not confirmed yet.
export interface PendingMessage {
  id: string
  conversationId: string
  // Already checked with checkTextMessage.
  content: string
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
  retry: (message: PendingMessage) => void
  discard: (id: string) => void
}

// Messages written in this session. Each one shows at once as pending and moves to `sent`
// when the server confirms it. A failed one stays until it is retried or discarded.
export function useOutgoingMessages(): OutgoingMessages {
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [sent, setSent] = useState<Message[]>([])

  const deliver = useCallback((message: PendingMessage) => {
    void sendTextMessage(message.conversationId, message.content, message.id)
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

  const send = useCallback(
    (conversationId: string, content: string) => {
      const message: PendingMessage = {
        id: crypto.randomUUID(),
        conversationId,
        content,
        createdAt: new Date().toISOString(),
        status: 'sending',
        error: null,
      }
      setPending((list) => [...list, message])
      deliver(message)
    },
    [deliver],
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

  return { pending, sent, send, retry, discard }
}

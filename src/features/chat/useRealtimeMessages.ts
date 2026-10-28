import { useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseMessageRow } from './api'
import type { Message } from './types'

// connecting: before the first successful subscription (shown as nothing special).
// live: new messages arrive. interrupted: the connection dropped and is being retried.
export type RealtimeStatus = 'connecting' | 'live' | 'interrupted'

export interface RealtimeMessages {
  // New messages received since the chat screen opened, in arrival order.
  received: Message[]
  status: RealtimeStatus
}

// Listens for new messages in every conversation the user belongs to. Realtime checks
// the messages RLS policy for each subscriber, so only members receive a message.
// `onLive` runs each time the subscription becomes active, including after a
// reconnect: messages sent while it was not active are never delivered, so the caller
// reloads what it shows.
export function useRealtimeMessages(userId: string, onLive: () => void): RealtimeMessages {
  const [received, setReceived] = useState<Message[]>([])
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const handleLive = useEffectEvent(onLive)

  useEffect(() => {
    let active = true
    // A unique topic: a channel that is still being removed is never reused.
    const channel = supabase.channel(`messages:${userId}:${crypto.randomUUID()}`, {
      // SUBSCRIBED only once the server confirms the postgres_changes subscription.
      config: { postgres_changes_options: { wait: true } },
    })

    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (!active) return
        // Error events (e.g. 401) carry no row and are ignored.
        if (payload.errors?.length) return
        const message = parseMessageRow(payload.new)
        if (!message) return
        setReceived((list) => (list.some((item) => item.id === message.id) ? list : [...list, message]))
      })
      .subscribe((state) => {
        if (!active) return
        if (state === 'SUBSCRIBED') {
          setStatus('live')
          handleLive()
        } else {
          // CHANNEL_ERROR, TIMED_OUT or CLOSED: the client retries on its own.
          setStatus('interrupted')
        }
      })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId])

  return { received, status }
}

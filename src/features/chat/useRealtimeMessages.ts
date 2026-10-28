import { useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseMemberRow, parseMessageRow } from './api'
import { laterReadMarker, withUpdate } from './helpers'
import type { MemberRead, Message } from './types'

// connecting: before the first successful subscription (shown as nothing special).
// live: new messages arrive. interrupted: the connection dropped and is being retried.
export type RealtimeStatus = 'connecting' | 'live' | 'interrupted'

export interface RealtimeMessages {
  // New messages received since the chat screen opened, in arrival order.
  received: Message[]
  // The newest copy of each message edited or recalled since the chat screen opened.
  updated: ReadonlyMap<string, Message>
  // The newest read marker Realtime reported for each member, keyed by readKey().
  memberReads: ReadonlyMap<string, string>
  // Memberships created since the chat screen opened (new chats, new group members).
  joined: MemberRead[]
  status: RealtimeStatus
}

// The key of a member's read marker in RealtimeMessages.memberReads.
export function readKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`
}

// Listens for new, edited and recalled messages and for membership changes in every conversation the user belongs to. Realtime checks
// the messages RLS policy for each subscriber, so only members receive a message.
// `onLive` runs each time the subscription becomes active, including after a
// reconnect: messages sent while it was not active are never delivered, so the caller
// reloads what it shows.
export function useRealtimeMessages(userId: string, onLive: () => void): RealtimeMessages {
  const [received, setReceived] = useState<Message[]>([])
  const [updated, setUpdated] = useState<ReadonlyMap<string, Message>>(new Map())
  const [memberReads, setMemberReads] = useState<ReadonlyMap<string, string>>(new Map())
  const [joined, setJoined] = useState<MemberRead[]>([])
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        if (!active || payload.errors?.length) return
        const message = parseMessageRow(payload.new)
        if (message) setUpdated((map) => withUpdate(map, message))
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_members' },
        (payload) => {
          if (!active || payload.errors?.length) return
          const member = parseMemberRow(payload.new)
          if (member) setJoined((list) => [...list, member])
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_members' },
        (payload) => {
          if (!active || payload.errors?.length) return
          const member = parseMemberRow(payload.new)
          if (!member?.lastReadAt) return
          const key = readKey(member.conversationId, member.userId)
          const readAt = member.lastReadAt
          // Markers only move forward; an older report never replaces a newer one.
          setMemberReads((map) => {
            const next = laterReadMarker(map.get(key), readAt)
            return next === map.get(key) ? map : new Map(map).set(key, readAt)
          })
        },
      )
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

  return { received, updated, memberReads, joined, status }
}

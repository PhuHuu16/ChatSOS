import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseMemberRow, parseMessageRow, parseRemovalRow } from './api'
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
  // Groups the user was removed from or left since the chat screen opened, and has not
  // been added back to since. They are no longer readable for the user.
  removed: ReadonlySet<string>
  // Records that the user left a group here, before Realtime reports it.
  markRemoved: (conversationId: string) => void
  // When the user was last removed from or left each group (server time, ISO 8601). If
  // they are added back, they may see only what came later, as the server already does;
  // this drops older copies still in memory (received live, or a page loaded before).
  removedAt: ReadonlyMap<string, string>
  status: RealtimeStatus
}

// The key of a member's read marker in RealtimeMessages.memberReads.
export function readKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`
}

// Listens for new, edited and recalled messages and for membership changes in every
// conversation the user belongs to. Realtime checks the RLS policies for each subscriber,
// so only members receive a message. Realtime sends no DELETE events, so a member removed
// from a group (or leaving it) learns of it from their own conversation_removals row.
// `onLive` runs each time the subscription becomes active, including after a
// reconnect: messages sent while it was not active are never delivered, so the caller
// reloads what it shows.
export function useRealtimeMessages(userId: string, onLive: () => void): RealtimeMessages {
  const [received, setReceived] = useState<Message[]>([])
  const [updated, setUpdated] = useState<ReadonlyMap<string, Message>>(new Map())
  const [memberReads, setMemberReads] = useState<ReadonlyMap<string, string>>(new Map())
  const [joined, setJoined] = useState<MemberRead[]>([])
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [removedAt, setRemovedAt] = useState<ReadonlyMap<string, string>>(new Map())
  const markRemoved = useCallback((conversationId: string) => {
    setRemoved((set) => (set.has(conversationId) ? set : new Set(set).add(conversationId)))
  }, [])
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
          if (!member) return
          setJoined((list) => [...list, member])
          // Added (back) to a group the user had been removed from or left.
          if (member.userId === userId) {
            setRemoved((set) => {
              if (!set.has(member.conversationId)) return set
              const next = new Set(set)
              next.delete(member.conversationId)
              return next
            })
          }
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
      // Written by remove_group_member() and leave_group(); UPDATE when written again.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_removals' },
        (payload) => {
          if (!active || payload.errors?.length) return
          const removal = parseRemovalRow(payload.new)
          if (!removal) return
          markRemoved(removal.conversationId)
          setRemovedAt((map) => {
            const known = map.get(removal.conversationId)
            const next = laterReadMarker(known, removal.removedAt)
            return next === known ? map : new Map(map).set(removal.conversationId, removal.removedAt)
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
  }, [userId, markRemoved])

  return { received, updated, memberReads, joined, removed, markRemoved, removedAt, status }
}

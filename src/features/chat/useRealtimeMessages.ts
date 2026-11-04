import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseMemberRow, parseMessageRow, parseRemovalRow } from './api'
import { laterReadMarker, withUpdate } from './helpers'
import type { MemberRead, Message } from './types'

export type RealtimeStatus = 'connecting' | 'live' | 'interrupted'

export interface RealtimeMessages {
  received: Message[]
  updated: ReadonlyMap<string, Message>
  memberReads: ReadonlyMap<string, string>
  joined: MemberRead[]
  removed: ReadonlySet<string>
  markRemoved: (conversationId: string) => void
  removedAt: ReadonlyMap<string, string>
  status: RealtimeStatus
}

export function readKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`
}

// Nhận tin nhắn thời gian thực
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
    const channel = supabase.channel(`messages:${userId}:${crypto.randomUUID()}`, {
      config: { postgres_changes_options: { wait: true } },
    })

    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (!active) return
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
          setMemberReads((map) => {
            const next = laterReadMarker(map.get(key), readAt)
            return next === map.get(key) ? map : new Map(map).set(key, readAt)
          })
        },
      )
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

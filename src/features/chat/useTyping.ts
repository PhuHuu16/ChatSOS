import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const ANNOUNCE_EVERY = 3000
const TYPING_TIMEOUT = 6000
const EVENT = 'typing'

export interface Typing {
  typingUserIds: string[]
  setTyping: (typing: boolean) => void
}

// Trạng thái đang nhập
export function useTyping(
  conversationId: string | null,
  currentUserId: string,
  memberIds: readonly string[],
): Typing {
  const [typing, setTypingUsers] = useState<{
    conversationId: string | null
    until: ReadonlyMap<string, number>
  }>({ conversationId, until: new Map() })
  const typingHere = typing.conversationId === conversationId ? typing.until : null
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const joinedRef = useRef(false)
  const announcedAtRef = useRef(0)

  useEffect(() => {
    if (conversationId === null) return
    let active = true
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    channelRef.current = channel
    channel
      .on('broadcast', { event: EVENT }, ({ payload }: { payload: unknown }) => {
        if (!active || typeof payload !== 'object' || payload === null) return
        const { userId, typing: isTyping } = payload as Record<string, unknown>
        if (typeof userId !== 'string' || userId === currentUserId) return
        setTypingUsers((state) => {
          const next = new Map(state.conversationId === conversationId ? state.until : [])
          if (isTyping === true) next.set(userId, Date.now() + TYPING_TIMEOUT)
          else next.delete(userId)
          return { conversationId, until: next }
        })
      })
      .subscribe((state) => {
        if (!active) return
        joinedRef.current = state === 'SUBSCRIBED'
        if (state === 'CHANNEL_ERROR') void supabase.removeChannel(channel)
      })

    return () => {
      active = false
      if (joinedRef.current && announcedAtRef.current > 0) {
        void channel.send({
          type: 'broadcast',
          event: EVENT,
          payload: { userId: currentUserId, typing: false },
        })
      }
      announcedAtRef.current = 0
      joinedRef.current = false
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [conversationId, currentUserId])

  const hasTyping = (typingHere?.size ?? 0) > 0
  useEffect(() => {
    if (!hasTyping) return
    const timer = setInterval(() => {
      const now = Date.now()
      setTypingUsers((state) => {
        const next = new Map([...state.until].filter(([, until]) => until > now))
        return next.size === state.until.size ? state : { ...state, until: next }
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [hasTyping])

  const setTyping = useCallback(
    (isTyping: boolean) => {
      const channel = channelRef.current
      if (!channel || !joinedRef.current) return
      const now = Date.now()
      if (isTyping) {
        if (now - announcedAtRef.current < ANNOUNCE_EVERY) return
        announcedAtRef.current = now
      } else {
        if (announcedAtRef.current === 0) return
        announcedAtRef.current = 0
      }
      void channel.send({
        type: 'broadcast',
        event: EVENT,
        payload: { userId: currentUserId, typing: isTyping },
      })
    },
    [currentUserId],
  )

  const typingUserIds = [...(typingHere?.keys() ?? [])].filter((id) => memberIds.includes(id))
  return { typingUserIds, setTyping }
}

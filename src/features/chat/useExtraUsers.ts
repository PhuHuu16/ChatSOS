import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchUsers } from './api'
import type { User } from './types'

export interface ExtraUsers {
  // Profiles loaded on request, e.g. of people who have left a group.
  users: User[]
  // Loads the profiles of `ids` not requested before. Safe to call on every render.
  request: (ids: string[]) => void
}

// Profiles the conversation list does not load: senders and system message targets who
// are no longer members. Each id is requested once per session; a failed or empty answer
// (e.g. a deleted account) is not retried, and the name shows as "someone".
export function useExtraUsers(): ExtraUsers {
  const [users, setUsers] = useState<User[]>([])
  const requestedRef = useRef(new Set<string>())
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  const request = useCallback((ids: string[]) => {
    const fresh = [...new Set(ids)].filter((id) => !requestedRef.current.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) requestedRef.current.add(id)
    void fetchUsers(fresh)
      .catch(() => null)
      .then((result) => {
        if (!activeRef.current || !result?.ok || result.data.length === 0) return
        setUsers((current) => {
          const known = new Set(current.map((user) => user.id))
          return [...current, ...result.data.filter((user) => !known.has(user.id))]
        })
      })
  }, [])

  return { users, request }
}

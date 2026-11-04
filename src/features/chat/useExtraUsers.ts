import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchUsers } from './api'
import type { User } from './types'

export interface ExtraUsers {
  users: User[]
  request: (ids: string[]) => void
}

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

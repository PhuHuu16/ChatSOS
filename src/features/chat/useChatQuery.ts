import { useCallback, useEffect, useState } from 'react'
import type { ChatResult } from './api'
import type { ChatErrorKey } from './chatErrors'

export type ChatQueryState<T> = (
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ChatErrorKey }
) & { reload: () => void }

interface Settled<T> {
  key: string
  attempt: number
  result: ChatResult<T>
}

export function useChatQuery<T>(
  key: string | null,
  load: (key: string) => Promise<ChatResult<T>>,
): ChatQueryState<T> {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    if (key === null) return
    let active = true
    load(key)
      .catch((): ChatResult<T> => ({ ok: false, error: 'chat.errors.loadFailed' }))
      .then((result) => {
        if (active) setSettled({ key, attempt, result })
      })
    return () => {
      active = false
    }
  }, [key, attempt, load])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  if (key === null || settled?.key !== key) return { status: 'loading', reload }
  if (!settled.result.ok) {
    if (settled.attempt !== attempt) return { status: 'loading', reload }
    return { status: 'error', error: settled.result.error, reload }
  }
  return { status: 'ready', data: settled.result.data, reload }
}

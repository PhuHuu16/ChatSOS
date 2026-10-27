import { useCallback, useEffect, useState } from 'react'
import type { ChatResult } from './api'
import type { ChatErrorKey } from './chatErrors'

export type ChatQueryState<T> = (
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ChatErrorKey }
) & { retry: () => void }

interface Settled<T> {
  key: string
  attempt: number
  result: ChatResult<T>
}

// Loads `load(key)` whenever `key` changes (null = nothing to load) and on retry().
// `load` must be stable (a module-level function). "Loading" is derived from whether the
// last settled result belongs to the current key and attempt, so the effect never sets
// state synchronously and a late response for an old key is never shown.
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

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  if (key === null || settled?.key !== key || settled.attempt !== attempt) {
    return { status: 'loading', retry }
  }
  if (!settled.result.ok) return { status: 'error', error: settled.result.error, retry }
  return { status: 'ready', data: settled.result.data, retry }
}

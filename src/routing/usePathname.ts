import { useSyncExternalStore } from 'react'
import { getPathname, subscribeToPathname } from './navigation'

export function usePathname(): string {
  return useSyncExternalStore(subscribeToPathname, getPathname)
}

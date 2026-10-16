import { useSyncExternalStore } from 'react'
import { getPathname, subscribeToPathname } from './navigation'

// The current path; re-renders after navigate() and the browser's Back / Forward buttons.
export function usePathname(): string {
  return useSyncExternalStore(subscribeToPathname, getPathname)
}

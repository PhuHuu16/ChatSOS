import { useSyncExternalStore } from 'react'

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export type Theme = 'light' | 'dark'

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

const STORAGE_KEY = 'chatsos.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value)
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(DARK_QUERY) : null
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): Theme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light'
  return preference
}

function applyTheme() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolveTheme(preference, darkQuery()?.matches ?? false)
}

let preference = readStoredPreference()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function getThemePreference(): ThemePreference {
  return preference
}

// Giao diện sáng/tối
export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next)
  } catch {
    // Bỏ qua lỗi
  }
  applyTheme()
  notify()
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current)
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? DEFAULT_THEME_PREFERENCE
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeThemePreference, getThemePreference, getThemePreference)
}

darkQuery()?.addEventListener('change', () => {
  if (preference === 'system') applyTheme()
})

applyTheme()

// Minimal client-side navigation on the History API (no router library). Only the app's own
// paths can be navigated to, so navigate() can never send the user to another origin.
export const PATHS = {
  chat: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
} as const

export type AppPath = (typeof PATHS)[keyof typeof PATHS]

// pushState / replaceState do not fire popstate, so navigate() announces changes itself.
const NAVIGATE_EVENT = 'chatsos:navigate'

export function getPathname(): string {
  return window.location.pathname
}

// replace: true swaps the current history entry (for redirects), so Back does not return to
// a page that would immediately redirect again. Pushing the current path is a no-op.
export function navigate(to: AppPath, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) {
    window.history.replaceState(null, '', to)
  } else if (to !== getPathname()) {
    window.history.pushState(null, '', to)
  } else {
    return
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

// Calls onChange after navigate() and after the browser's Back / Forward buttons.
export function subscribeToPathname(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

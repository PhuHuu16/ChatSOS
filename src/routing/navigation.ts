export const PATHS = {
  chat: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
} as const

export type AppPath = (typeof PATHS)[keyof typeof PATHS]

const NAVIGATE_EVENT = 'chatsos:navigate'

export function getPathname(): string {
  return window.location.pathname
}

// Điều hướng
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

export function subscribeToPathname(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

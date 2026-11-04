const KEY = 'chatsos:recovery'

let fallback: string | null = null

export function readRecoveryUserId(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? fallback
  } catch {
    return fallback
  }
}

export function markRecovery(userId: string): void {
  try {
    window.localStorage.setItem(KEY, userId)
    fallback = null
  } catch {
    fallback = userId
  }
}

export function clearRecovery(): void {
  fallback = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Bỏ qua lỗi
  }
}

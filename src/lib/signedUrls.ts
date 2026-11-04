import { supabase } from './supabase'

export interface SignedUrlCache {
  get: (path: string) => Promise<string | null>
  forget: (path: string) => void
  clear: () => void
}

export function createSignedUrlCache(
  bucket: string,
  lifetimeSeconds: number,
  refreshMarginSeconds: number,
): SignedUrlCache {
  const signedUrls = new Map<string, { url: string; expiresAt: number }>()
  let queue: { path: string; resolve: (url: string | null) => void }[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  async function flushQueue() {
    const batch = queue
    queue = []
    flushTimer = null
    const paths = [...new Set(batch.map((item) => item.path))]
    const response = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, lifetimeSeconds)
      .catch(() => ({ data: null }))
    const expiresAt = Date.now() + (lifetimeSeconds - refreshMarginSeconds) * 1000
    for (const item of response.data ?? []) {
      if (item.path && item.signedUrl && !item.error) {
        signedUrls.set(item.path, { url: item.signedUrl, expiresAt })
      }
    }
    for (const { path, resolve } of batch) resolve(signedUrls.get(path)?.url ?? null)
  }

  return {
    get(path) {
      const cached = signedUrls.get(path)
      if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url)
      return new Promise((resolve) => {
        queue.push({ path, resolve })
        flushTimer ??= setTimeout(() => void flushQueue(), 0)
      })
    },
    forget(path) {
      signedUrls.delete(path)
    },
    clear() {
      signedUrls.clear()
    },
  }
}

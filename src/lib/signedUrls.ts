// Signed URLs for files in a private Storage bucket. Paths requested in the same tick are
// signed together with one request, and each URL is reused until shortly before it
// expires. Each cache serves one bucket only, so paths and URLs of different buckets never
// mix. URLs are never logged: anyone who has one can open the file until it expires.
import { supabase } from './supabase'

export interface SignedUrlCache {
  // A URL for the file, or null when it cannot be read (e.g. it does not exist, or the
  // caller may not read it: Storage answers "not found" for both).
  get: (path: string) => Promise<string | null>
  // Drops the cached URL, e.g. after the file was replaced, removed or failed to load.
  forget: (path: string) => void
  // Drops every cached URL, e.g. on sign-out.
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

  // Signs every path requested in the same tick with one request.
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

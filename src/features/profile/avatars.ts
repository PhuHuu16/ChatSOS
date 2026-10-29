// Avatar files in the private avatars bucket: uploading a prepared JPEG, removing a file,
// and the signed URLs used to show avatars. Kept apart from chat attachments: its own
// bucket and its own URL cache.
import { useCallback, useEffect, useState } from 'react'
import { createSignedUrlCache } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'

const BUCKET = 'avatars'
// Same lifetime and refresh margin as attachment URLs.
const URL_LIFETIME_SECONDS = 3600
const URL_REFRESH_MARGIN_SECONDS = 300

const signedUrls = createSignedUrlCache(BUCKET, URL_LIFETIME_SECONDS, URL_REFRESH_MARGIN_SECONDS)

export type AvatarUploadErrorKey =
  | 'profile.errors.uploadNetwork'
  | 'profile.errors.uploadNotAllowed'
  | 'profile.errors.uploadTooLarge'
  | 'profile.errors.uploadFailed'

// Storage answers many refusals with HTTP 400 and puts the meaningful code in
// `statusCode` (e.g. "403" not allowed, "413" too large). Same reading as for attachments.
function storageStatus(error: unknown): number | null {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
  const value = Number(statusCode ?? status)
  return Number.isFinite(value) && value > 0 ? value : null
}

// Uploads a JPEG prepared by prepareAvatarImage to `path` (a new name from newAvatarPath).
// Never overwrites: there is no upsert, and the bucket has no UPDATE policy.
export async function uploadAvatar(
  path: string,
  image: Blob,
): Promise<{ ok: true } | { ok: false; error: AvatarUploadErrorKey }> {
  // A Blob is sent as multipart form data, where Storage takes the type from the Blob
  // itself; the bucket only accepts image/jpeg.
  const body = new Blob([image], { type: 'image/jpeg' })
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { upsert: false })
    .catch((error: unknown) => ({ error }))
  if (!upload.error) return { ok: true }
  const status = storageStatus(upload.error)
  // No HTTP status: the request did not get an answer.
  if (status === null) return { ok: false, error: 'profile.errors.uploadNetwork' }
  if (status === 413) return { ok: false, error: 'profile.errors.uploadTooLarge' }
  if (status === 401 || status === 403) return { ok: false, error: 'profile.errors.uploadNotAllowed' }
  return { ok: false, error: 'profile.errors.uploadFailed' }
}

// 'removed': Storage confirmed this exact path as deleted. 'notConfirmed': no error, but
// the answer does not list the path (the cause is not known). 'failed': an error or no
// answer. Only 'removed' means the file is gone.
export type RemoveOutcome = 'removed' | 'notConfirmed' | 'failed'

// Callers must check the path first (see saveProfile): this only asks Storage, whose
// policies are a second line of defence, not the only one.
export async function removeAvatarFile(path: string): Promise<RemoveOutcome> {
  signedUrls.forget(path)
  const response = await supabase.storage
    .from(BUCKET)
    .remove([path])
    .catch(() => null)
  if (!response || response.error) return 'failed'
  return response.data.some((object) => object.name === path) ? 'removed' : 'notConfirmed'
}

export function forgetAvatarUrl(path: string) {
  signedUrls.forget(path)
}

// Forgets every avatar URL, e.g. on sign-out: signed URLs work for anyone who has them.
export function clearAvatarUrls() {
  signedUrls.clear()
}

export interface AvatarUrlState {
  // The URL to show, or null while it loads or when there is none.
  url: string | null
  // Asks for a fresh URL once (e.g. the image failed to load). False once used.
  canRetry: boolean
  retry: () => void
}

export function useAvatarUrl(path: string | null): AvatarUrlState {
  const [result, setResult] = useState<{ path: string; attempt: number; url: string | null } | null>(
    null,
  )
  // The path whose URL was already renewed once; it is not renewed again.
  const [retriedPath, setRetriedPath] = useState<string | null>(null)
  const attempt = path !== null && retriedPath === path ? 1 : 0

  useEffect(() => {
    if (path === null) return
    let active = true
    void signedUrls.get(path).then((url) => {
      if (active) setResult({ path, attempt, url })
    })
    return () => {
      active = false
    }
  }, [path, attempt])

  const retry = useCallback(() => {
    if (path === null || retriedPath === path) return
    signedUrls.forget(path)
    setRetriedPath(path)
  }, [path, retriedPath])

  const current = result !== null && result.path === path && result.attempt === attempt
  return {
    url: current ? result.url : null,
    canRetry: path !== null && retriedPath !== path,
    retry,
  }
}

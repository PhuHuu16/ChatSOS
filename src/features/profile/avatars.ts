import { useCallback, useEffect, useState } from 'react'
import { createSignedUrlCache } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'

const BUCKET = 'avatars'
const URL_LIFETIME_SECONDS = 3600
const URL_REFRESH_MARGIN_SECONDS = 300

const signedUrls = createSignedUrlCache(BUCKET, URL_LIFETIME_SECONDS, URL_REFRESH_MARGIN_SECONDS)

export type AvatarUploadErrorKey =
  | 'profile.errors.uploadNetwork'
  | 'profile.errors.uploadNotAllowed'
  | 'profile.errors.uploadTooLarge'
  | 'profile.errors.uploadFailed'

function storageStatus(error: unknown): number | null {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
  const value = Number(statusCode ?? status)
  return Number.isFinite(value) && value > 0 ? value : null
}

// Tải ảnh đại diện lên
export async function uploadAvatar(
  path: string,
  image: Blob,
): Promise<{ ok: true } | { ok: false; error: AvatarUploadErrorKey }> {
  const body = new Blob([image], { type: 'image/jpeg' })
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { upsert: false })
    .catch((error: unknown) => ({ error }))
  if (!upload.error) return { ok: true }
  const status = storageStatus(upload.error)
  if (status === null) return { ok: false, error: 'profile.errors.uploadNetwork' }
  if (status === 413) return { ok: false, error: 'profile.errors.uploadTooLarge' }
  if (status === 401 || status === 403) return { ok: false, error: 'profile.errors.uploadNotAllowed' }
  return { ok: false, error: 'profile.errors.uploadFailed' }
}

export type RemoveOutcome = 'removed' | 'notConfirmed' | 'failed'

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

export function clearAvatarUrls() {
  signedUrls.clear()
}

export interface AvatarUrlState {
  url: string | null
  canRetry: boolean
  retry: () => void
}

export function useAvatarUrl(path: string | null): AvatarUrlState {
  const [result, setResult] = useState<{ path: string; attempt: number; url: string | null } | null>(
    null,
  )
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

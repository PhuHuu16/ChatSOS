import { useEffect, useState } from 'react'
import { createSignedUrlCache } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'
import { insertAttachmentMessage, type ChatResult } from './api'
import type { ChatErrorKey } from './chatErrors'
import type { Message } from './types'

const BUCKET = 'attachments'
export const ATTACHMENT_MAX_MB = 20
const ATTACHMENT_MAX_BYTES = ATTACHMENT_MAX_MB * 1024 * 1024
const NAME_MAX_LENGTH = 255
const URL_LIFETIME_SECONDS = 3600
const URL_REFRESH_MARGIN_SECONDS = 300

const TYPES: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
}

export const ATTACHMENT_ACCEPT = Object.keys(TYPES)
  .map((extension) => `.${extension}`)
  .join(',')

export interface CheckedFile {
  kind: 'image' | 'file'
  extension: string
  mime: string
  name: string
  size: number
}

export type FileCheckErrorKey =
  | 'chat.errors.fileTooLarge'
  | 'chat.errors.fileEmpty'
  | 'chat.errors.fileType'

export type FileCheck = { ok: true; file: CheckedFile } | { ok: false; error: FileCheckErrorKey }

function extensionForType(type: string): string | undefined {
  return Object.keys(TYPES).find((extension) => TYPES[extension]?.includes(type))
}

// Kiểm tra tệp
export function checkAttachmentFile(file: { name: string; size: number; type: string }): FileCheck {
  const extension =
    /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? extensionForType(file.type)
  const allowed = extension === undefined ? undefined : TYPES[extension]
  if (extension === undefined || allowed === undefined) {
    return { ok: false, error: 'chat.errors.fileType' }
  }
  if (file.size === 0) return { ok: false, error: 'chat.errors.fileEmpty' }
  if (file.size > ATTACHMENT_MAX_BYTES) return { ok: false, error: 'chat.errors.fileTooLarge' }
  const mime = allowed.includes(file.type) ? file.type : (allowed[0] ?? '')
  return {
    ok: true,
    file: {
      kind: mime.startsWith('image/') ? 'image' : 'file',
      extension,
      mime,
      name: attachmentName(file.name, extension),
      size: file.size,
    },
  }
}

export function attachmentName(name: string, extension: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[/\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim()
  const chars = [...cleaned]
  if (chars.length === 0) return `file.${extension}`
  if (chars.length <= NAME_MAX_LENGTH) return cleaned
  const suffix = `.${extension}`
  return chars.slice(0, NAME_MAX_LENGTH - suffix.length).join('') + suffix
}

export function newAttachmentPath(conversationId: string, extension: string): string {
  return `${conversationId}/${crypto.randomUUID()}.${extension}`
}

function storageStatus(error: unknown): number | null {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
  const value = Number(statusCode ?? status)
  return Number.isFinite(value) && value > 0 ? value : null
}

function uploadErrorKey(error: unknown): ChatErrorKey {
  const status = storageStatus(error)
  if (status === null) return 'chat.errors.network'
  if (status === 413) return 'chat.errors.fileTooLarge'
  if (status === 415) return 'chat.errors.fileType'
  if (status === 401 || status === 403) return 'chat.errors.notAllowed'
  return 'chat.errors.sendFailed'
}

// Tải tệp lên
export async function sendAttachment(
  conversationId: string,
  file: Blob,
  checked: CheckedFile,
  path: string,
  id: string,
): Promise<ChatResult<Message>> {
  const body = new Blob([file], { type: checked.mime })
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { upsert: false })
    .catch((error: unknown) => ({ error }))
  if (upload.error && storageStatus(upload.error) !== 409) {
    return { ok: false, error: uploadErrorKey(upload.error) }
  }
  return insertAttachmentMessage(
    conversationId,
    checked.kind,
    { path, name: checked.name, size: checked.size, mime: checked.mime },
    id,
  )
}

const localUrls = new Map<string, string>()
const signedUrls = createSignedUrlCache(BUCKET, URL_LIFETIME_SECONDS, URL_REFRESH_MARGIN_SECONDS)

export function getAttachmentUrl(path: string): Promise<string | null> {
  const local = localUrls.get(path)
  if (local) return Promise.resolve(local)
  return signedUrls.get(path)
}

export function setLocalAttachmentUrl(path: string, file: Blob) {
  if (!localUrls.has(path)) localUrls.set(path, URL.createObjectURL(file))
}

export async function removeAttachment(path: string): Promise<void> {
  const local = localUrls.get(path)
  if (local) URL.revokeObjectURL(local)
  localUrls.delete(path)
  signedUrls.forget(path)
  await supabase.storage
    .from(BUCKET)
    .remove([path])
    .catch(() => undefined)
}

export function clearAttachmentUrls() {
  for (const url of localUrls.values()) URL.revokeObjectURL(url)
  localUrls.clear()
  signedUrls.clear()
}

export type AttachmentUrlState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error' }

export function useAttachmentUrl(path: string): AttachmentUrlState {
  const [result, setResult] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    let active = true
    void getAttachmentUrl(path).then((url) => {
      if (active) setResult({ path, url })
    })
    return () => {
      active = false
    }
  }, [path])

  if (result?.path !== path) return { status: 'loading' }
  return result.url ? { status: 'ready', url: result.url } : { status: 'error' }
}

// Tải tệp về
export async function downloadAttachment(path: string, name: string): Promise<boolean> {
  const response = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60)
    .catch(() => ({ data: null }))
  const url = response.data?.signedUrl
  if (!url) return false
  window.location.assign(`${url}&download=${encodeURIComponent(name)}`)
  return true
}

export function formatFileSize(bytes: number, language: string): string {
  const units = ['B', 'KB', 'MB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: unit === 0 ? 0 : 1 })
  return `${number.format(value)} ${units[unit]}`
}

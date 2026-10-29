// Files sent in chats: checking a picked file, uploading it to the private attachments
// bucket, and the URLs used to show or download it.
import { useEffect, useState } from 'react'
import { createSignedUrlCache } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'
import { insertAttachmentMessage, type ChatResult } from './api'
import type { ChatErrorKey } from './chatErrors'
import type { Message } from './types'

const BUCKET = 'attachments'
// Same as the bucket's file_size_limit and the messages_attachment_size_valid check.
export const ATTACHMENT_MAX_MB = 20
const ATTACHMENT_MAX_BYTES = ATTACHMENT_MAX_MB * 1024 * 1024
// Same as the messages_attachment_name_valid check.
const NAME_MAX_LENGTH = 255
// Signed URLs are reused until this long before they expire.
const URL_LIFETIME_SECONDS = 3600
const URL_REFRESH_MARGIN_SECONDS = 300

// Extension -> the MIME types the database accepts for it (messages_attachment_type_valid
// and the bucket's allowed_mime_types). The first one is used when the browser reports
// no type or a different one.
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

// For the file picker's `accept` attribute.
export const ATTACHMENT_ACCEPT = Object.keys(TYPES)
  .map((extension) => `.${extension}`)
  .join(',')

export interface CheckedFile {
  kind: 'image' | 'file'
  extension: string
  mime: string
  // Safe to show and store; see attachmentName.
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

// The extension decides the type, so a ".png" is always stored and served as an image,
// whatever the browser reports. A pasted image without a name uses its reported type.
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

// The file name shown to others: without path separators or control characters (which
// the database rejects), at most NAME_MAX_LENGTH characters, keeping the extension.
export function attachmentName(name: string, extension: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are what is removed
  const cleaned = name.replace(/[/\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim()
  const chars = [...cleaned]
  if (chars.length === 0) return `file.${extension}`
  if (chars.length <= NAME_MAX_LENGTH) return cleaned
  const suffix = `.${extension}`
  return chars.slice(0, NAME_MAX_LENGTH - suffix.length).join('') + suffix
}

// A new, never reused object name inside the conversation's folder.
export function newAttachmentPath(conversationId: string, extension: string): string {
  return `${conversationId}/${crypto.randomUUID()}.${extension}`
}

// Storage answers many refusals with HTTP 400 and puts the meaningful code in
// `statusCode` (e.g. "409" already exists, "403" not allowed, "415" type not allowed).
function storageStatus(error: unknown): number | null {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
  const value = Number(statusCode ?? status)
  return Number.isFinite(value) && value > 0 ? value : null
}

function uploadErrorKey(error: unknown): ChatErrorKey {
  const status = storageStatus(error)
  // No HTTP status: the request did not reach the server.
  if (status === null) return 'chat.errors.network'
  if (status === 413) return 'chat.errors.fileTooLarge'
  if (status === 415) return 'chat.errors.fileType'
  if (status === 401 || status === 403) return 'chat.errors.notAllowed'
  return 'chat.errors.sendFailed'
}

// Uploads the file to `path`, then sends the message. Retrying with the same `path` and
// `id` is safe: a file an earlier attempt uploaded is not uploaded again (409), and the
// message is never stored twice.
export async function sendAttachment(
  conversationId: string,
  file: Blob,
  checked: CheckedFile,
  path: string,
  id: string,
): Promise<ChatResult<Message>> {
  // A Blob is sent as multipart form data, where Storage takes the type from the Blob
  // itself (not the contentType option). It must equal the type the message declares.
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

// ---- URLs ----

// Images sent from this tab, shown from memory instead of being downloaded again.
const localUrls = new Map<string, string>()
const signedUrls = createSignedUrlCache(BUCKET, URL_LIFETIME_SECONDS, URL_REFRESH_MARGIN_SECONDS)

// A URL that shows the attachment, or null when it cannot be read (e.g. it was never
// uploaded). Storage answers "not found" both for missing files and for files the caller
// may not read.
export function getAttachmentUrl(path: string): Promise<string | null> {
  const local = localUrls.get(path)
  if (local) return Promise.resolve(local)
  return signedUrls.get(path)
}

// Shows the image picked for a message that is still being sent.
export function setLocalAttachmentUrl(path: string, file: Blob) {
  if (!localUrls.has(path)) localUrls.set(path, URL.createObjectURL(file))
}

// Removes a file the caller uploaded that no message uses any more: its message was
// recalled, or it was never sent. Storage refuses files still in use. Failures are
// ignored; the file then just stays in the bucket.
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

// Forgets every URL, e.g. on sign-out: signed URLs work for anyone who has them.
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

// Starts a download of the attachment under its original name. The signed URL answers
// with "Content-Disposition: attachment", so the page stays where it is.
export async function downloadAttachment(path: string, name: string): Promise<boolean> {
  const response = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60)
    .catch(() => ({ data: null }))
  const url = response.data?.signedUrl
  if (!url) return false
  // storage-js's own `download` option encodes the name twice (URLSearchParams, then
  // encodeURI), which garbles names with spaces or accents, so it is added here once.
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

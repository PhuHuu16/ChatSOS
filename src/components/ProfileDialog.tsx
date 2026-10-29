import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { validateDisplayName } from '../features/auth/validation'
import {
  AVATAR_INPUT_ACCEPT,
  AVATAR_INPUT_MAX_MB,
  AVATAR_INPUT_MAX_MEGAPIXELS,
  prepareAvatarImage,
  type AvatarImageErrorKey,
} from '../features/profile/avatarImage'
import type { AvatarUploadErrorKey } from '../features/profile/avatars'
import {
  fetchOwnProfile,
  type OwnProfile,
  type ProfileSaveErrorKey,
} from '../features/profile/profileApi'
import {
  saveProfile,
  type AvatarRequest,
  type SaveProfileResult,
} from '../features/profile/saveProfile'
import { useObjectUrl } from '../features/profile/useObjectUrl'
import { Avatar } from './Avatar'

interface ProfileDialogProps {
  // The signed-in user (from the session); the dialog only ever saves this user's profile.
  currentUserId: string
  profile: OwnProfile
  onClose: () => void
  // The profile as the database now stores it: after a save, or after reloading it.
  onProfileUpdated: (profile: OwnProfile) => void
}

// A picked photo is kept in the dialog until Save uploads it.
type AvatarChange = { kind: 'none' } | { kind: 'new'; blob: Blob } | { kind: 'remove' }

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'nothingToSave' }
  | { kind: 'conflict'; name: string }
  | { kind: 'conflictReloadFailed' }
  | { kind: 'notSaved' }
  | { kind: 'unknown'; name: string }
  | { kind: 'unknownReloadFailed' }
  | { kind: 'failed'; error: ProfileSaveErrorKey | AvatarUploadErrorKey }
  | { kind: 'image'; error: AvatarImageErrorKey }

// Extra lines about files that could not be cleaned up, shown under the main message.
type CleanupNote =
  | 'profile.cleanup.oldNotConfirmed'
  | 'profile.cleanup.oldFailed'
  | 'profile.cleanup.newNotConfirmed'
  | 'profile.cleanup.newFailed'
  | 'profile.cleanup.newKept'

function cleanupNotes(result: SaveProfileResult): CleanupNote[] {
  const notes: CleanupNote[] = []
  if (result.cleanup.old === 'notConfirmed') notes.push('profile.cleanup.oldNotConfirmed')
  if (result.cleanup.old === 'failed') notes.push('profile.cleanup.oldFailed')
  if (result.cleanup.new === 'notConfirmed') notes.push('profile.cleanup.newNotConfirmed')
  if (result.cleanup.new === 'failed') notes.push('profile.cleanup.newFailed')
  if (result.newFileKept) notes.push('profile.cleanup.newKept')
  return notes
}

const BUTTON_CLASS =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60'

// Rendered only while open. Closing it (Cancel, ×, Escape) drops every unsaved change.
export function ProfileDialog({ currentUserId, profile, onClose, onProfileUpdated }: ProfileDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The stored profile the next save compares against (compare-and-set).
  const [base, setBase] = useState(profile)
  const [name, setName] = useState(profile.displayName)
  const [nameTouched, setNameTouched] = useState(false)
  const [avatarChange, setAvatarChange] = useState<AvatarChange>({ kind: 'none' })
  const [previewUrl, setPreviewBlob] = useObjectUrl()
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [notes, setNotes] = useState<CleanupNote[]>([])
  // Blocks a second save before the saving state has re-rendered.
  const savingRef = useRef(false)
  // Only the newest picked photo may update the dialog.
  const pickRef = useRef(0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    nameRef.current?.focus()
  }, [])

  const nameError = nameTouched ? validateDisplayName(name) : null
  const busy = saving || processing
  const showsAvatar = avatarChange.kind === 'none' && base.avatarPath !== null
  const canRemove = avatarChange.kind === 'new' || showsAvatar

  function showStatus(next: Status, nextNotes: CleanupNote[] = []) {
    setStatus(next)
    setNotes(nextNotes)
  }

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Lets the same file be picked again later. A cancelled picker changes nothing.
    event.target.value = ''
    if (!file) return
    const pick = ++pickRef.current
    setProcessing(true)
    showStatus({ kind: 'idle' })
    const result = await prepareAvatarImage(file).catch(
      (): Awaited<ReturnType<typeof prepareAvatarImage>> => ({
        ok: false,
        error: 'profile.errors.imageEncode',
      }),
    )
    if (pick !== pickRef.current) return
    setProcessing(false)
    if (!result.ok) {
      showStatus({ kind: 'image', error: result.error })
      return
    }
    setAvatarChange({ kind: 'new', blob: result.blob })
    setPreviewBlob(result.blob)
  }

  function handleRemove() {
    pickRef.current += 1
    setProcessing(false)
    setPreviewBlob(null)
    // Without a stored avatar there is nothing to remove: only the picked photo is dropped.
    setAvatarChange(base.avatarPath === null ? { kind: 'none' } : { kind: 'remove' })
    showStatus({ kind: 'idle' })
  }

  // Takes a profile read from the database as the new base. What the user typed or picked
  // stays, so they decide whether to save it again.
  function adoptBase(stored: OwnProfile) {
    setBase(stored)
    onProfileUpdated(stored)
    if (stored.avatarPath === null) {
      setAvatarChange((change) => (change.kind === 'remove' ? { kind: 'none' } : change))
    }
  }

  async function reloadAfter(kind: 'conflict' | 'unknown', nextNotes: CleanupNote[]) {
    const fresh = await fetchOwnProfile(base.id).catch(() => null)
    if (!fresh?.ok) {
      showStatus(
        { kind: kind === 'conflict' ? 'conflictReloadFailed' : 'unknownReloadFailed' },
        nextNotes,
      )
      return
    }
    adoptBase(fresh.data)
    showStatus({ kind, name: fresh.data.displayName }, nextNotes)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current || processing) return
    setNameTouched(true)
    if (validateDisplayName(name)) {
      nameRef.current?.focus()
      return
    }
    const request: AvatarRequest =
      avatarChange.kind === 'new'
        ? { kind: 'replace', image: avatarChange.blob }
        : avatarChange.kind === 'remove'
          ? { kind: 'remove' }
          : { kind: 'keep' }

    savingRef.current = true
    setSaving(true)
    showStatus({ kind: 'idle' })
    try {
      const result = await saveProfile(currentUserId, base, name.trim(), request).catch(() => null)
      if (result === null) {
        // Should not happen; what was stored is not known, so it is read again.
        await reloadAfter('unknown', [])
        return
      }
      const resultNotes = cleanupNotes(result)
      switch (result.db) {
        case 'notAttempted':
          showStatus(
            result.error ? { kind: 'failed', error: result.error } : { kind: 'nothingToSave' },
            resultNotes,
          )
          break
        case 'saved':
          if (result.profile) {
            setBase(result.profile)
            setName(result.profile.displayName)
            onProfileUpdated(result.profile)
          }
          pickRef.current += 1
          setAvatarChange({ kind: 'none' })
          setPreviewBlob(null)
          showStatus({ kind: 'saved' }, resultNotes)
          break
        case 'conflict':
          await reloadAfter('conflict', resultNotes)
          break
        case 'failed':
          showStatus({ kind: 'failed', error: result.error ?? 'profile.errors.saveFailed' }, resultNotes)
          break
        case 'notSaved':
          if (result.profile) adoptBase(result.profile)
          showStatus({ kind: 'notSaved' }, resultNotes)
          break
        case 'unknown':
          if (result.profile) {
            adoptBase(result.profile)
            showStatus({ kind: 'unknown', name: result.profile.displayName }, resultNotes)
          } else {
            showStatus({ kind: 'unknownReloadFailed' }, resultNotes)
          }
          break
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const headingId = 'profile-heading'
  const nameErrorId = 'profile-name-error'

  let message: { text: string; error: boolean } | null = null
  switch (status.kind) {
    case 'saved':
      message = { text: t('profile.saved'), error: false }
      break
    case 'nothingToSave':
      message = { text: t('profile.nothingToSave'), error: false }
      break
    case 'conflict':
      message = { text: t('profile.errors.conflict', { name: status.name }), error: true }
      break
    case 'conflictReloadFailed':
      message = { text: t('profile.errors.conflictReloadFailed'), error: true }
      break
    case 'notSaved':
      message = { text: t('profile.errors.notSaved'), error: true }
      break
    case 'unknown':
      message = { text: t('profile.errors.unknown', { name: status.name }), error: true }
      break
    case 'unknownReloadFailed':
      message = { text: t('profile.errors.unknownReloadFailed'), error: true }
      break
    case 'failed':
      message = { text: t(status.error), error: true }
      break
    case 'image':
      message = {
        text: t(status.error, { maxMb: AVATAR_INPUT_MAX_MB, maxMegapixels: AVATAR_INPUT_MAX_MEGAPIXELS }),
        error: true,
      }
      break
    case 'idle':
      break
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex max-h-[85vh] flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 id={headingId} className="font-semibold">
            {t('profile.title')}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label={t('profile.close')}
            className="rounded-full px-2 py-1 text-xl leading-none text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-4">
            {avatarChange.kind === 'new' && previewUrl ? (
              <img
                src={previewUrl}
                alt={t('profile.previewAlt')}
                width={96}
                height={96}
                className="size-24 shrink-0 rounded-full object-cover"
              />
            ) : (
              <Avatar
                id={base.id}
                name={name.trim() || base.displayName}
                avatarPath={avatarChange.kind === 'remove' ? null : base.avatarPath}
                size="lg"
              />
            )}
            <div className="flex min-w-0 flex-col items-start gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={AVATAR_INPUT_ACCEPT}
                onChange={(event) => void handlePick(event)}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className={BUTTON_CLASS}
                >
                  {processing ? t('profile.processingPhoto') : t('profile.changePhoto')}
                </button>
                {canRemove && (
                  <button type="button" onClick={handleRemove} disabled={saving} className={BUTTON_CLASS}>
                    {t('profile.removePhoto')}
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {t('profile.photoHint', { maxMb: AVATAR_INPUT_MAX_MB })}
              </p>
            </div>
          </div>

          {avatarChange.kind !== 'none' && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {avatarChange.kind === 'remove' ? t('profile.removePending') : t('profile.photoPending')}
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('auth.fields.displayName')}
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameTouched(true)
              }}
              autoComplete="nickname"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              disabled={saving}
              className="rounded-md border border-slate-300 px-3 py-2 text-base font-normal focus-visible:outline-2 focus-visible:outline-brand-500 disabled:bg-slate-50"
            />
            {nameError && (
              <span id={nameErrorId} className="text-sm font-normal text-red-700">
                {t(nameError)}
              </span>
            )}
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('auth.fields.username')}</span>
            <span className="text-slate-700">@{base.username}</span>
            <span className="text-xs text-slate-500">{t('profile.usernameHint')}</span>
          </div>
        </div>

        <div aria-live="polite">
          {message && (
            <div
              role={message.error ? 'alert' : 'status'}
              className={`border-t px-4 py-2 text-sm ${
                message.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-800'
              }`}
            >
              <p>{message.text}</p>
              {notes.map((note) => (
                <p key={note} className="mt-1 text-amber-900">
                  {t(note)}
                </p>
              ))}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className={BUTTON_CLASS}>
            {t('profile.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? t(avatarChange.kind === 'new' ? 'profile.savingWithPhoto' : 'profile.saving')
              : t('profile.save')}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

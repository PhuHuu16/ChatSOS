import { isOwnAvatarPath, newAvatarPath } from './avatarPath'
import {
  forgetAvatarUrl,
  removeAvatarFile,
  uploadAvatar,
  type AvatarUploadErrorKey,
  type RemoveOutcome,
} from './avatars'
import {
  fetchOwnProfile,
  updateProfile,
  type OwnProfile,
  type ProfileChange,
  type ProfileSaveErrorKey,
  type ProfileSaveResult,
} from './profileApi'
import {
  afterUnknown,
  expectedFields,
  oldAvatarToRemove,
  shouldRemoveNewFile,
  type AvatarEdit,
  type DbOutcome,
} from './saveDecision'

export type AvatarRequest = { kind: 'keep' } | { kind: 'replace'; image: Blob } | { kind: 'remove' }

export type CleanupOutcome = RemoveOutcome | 'skipped'

export interface SaveProfileResult {
  db: DbOutcome | 'notAttempted'
  profile: OwnProfile | null
  error: ProfileSaveErrorKey | AvatarUploadErrorKey | null
  newFileKept: boolean
  cleanup: { old: CleanupOutcome; new: CleanupOutcome }
}

const NOTHING_REMOVED = { old: 'skipped', new: 'skipped' } as const

async function removeIfAllowed(
  path: string | null,
  allowed: string | null,
  currentUserId: string,
): Promise<CleanupOutcome> {
  if (path === null || allowed === null || path !== allowed) return 'skipped'
  if (!isOwnAvatarPath(path, currentUserId)) return 'skipped'
  return removeAvatarFile(path)
}

// Lưu hồ sơ
export async function saveProfile(
  currentUserId: string,
  base: OwnProfile,
  displayName: string,
  avatar: AvatarRequest,
): Promise<SaveProfileResult> {
  const notAttempted = (error: SaveProfileResult['error']): SaveProfileResult => ({
    db: 'notAttempted',
    profile: null,
    error,
    newFileKept: false,
    cleanup: NOTHING_REMOVED,
  })
  if (base.id !== currentUserId) return notAttempted('profile.errors.notAllowed')

  const wantsRemove = avatar.kind === 'remove' && base.avatarPath !== null
  if (displayName === base.displayName && avatar.kind !== 'replace' && !wantsRemove) {
    return notAttempted(null)
  }

  let uploadedPath: string | null = null
  if (avatar.kind === 'replace') {
    const path = newAvatarPath(currentUserId)
    const upload = await uploadAvatar(path, avatar.image)
    if (!upload.ok) return notAttempted(upload.error)
    uploadedPath = path
  }

  const edit: AvatarEdit =
    uploadedPath !== null
      ? { kind: 'replace', path: uploadedPath }
      : wantsRemove
        ? { kind: 'remove' }
        : { kind: 'keep' }
  const expected = expectedFields(base, displayName, edit)
  const change: ProfileChange = {}
  if (expected.displayName !== base.displayName) change.displayName = expected.displayName
  if (expected.avatarPath !== base.avatarPath) change.avatarPath = expected.avatarPath

  const result = await updateProfile(base, change).catch(
    (): ProfileSaveResult => ({ status: 'unknown' }),
  )

  let db: DbOutcome
  let confirmed: OwnProfile | null = null
  let reloaded: OwnProfile | null = null
  let error: SaveProfileResult['error'] = null
  if (result.status === 'saved') {
    db = 'saved'
    confirmed = result.profile
  } else if (result.status === 'conflict') {
    db = 'conflict'
  } else {
    const fresh = await fetchOwnProfile(base.id).catch(() => null)
    reloaded = fresh?.ok ? fresh.data : null
    const seen = afterUnknown(base, expected, reloaded)
    if (seen === 'saved') {
      db = 'saved'
      confirmed = reloaded
    } else if (seen === 'notSaved' && result.status === 'failed') {
      db = 'failed'
      error = result.error
    } else {
      db = seen
    }
  }

  const cleanup: SaveProfileResult['cleanup'] = { old: 'skipped', new: 'skipped' }
  if (uploadedPath !== null && shouldRemoveNewFile(db)) {
    cleanup.new = await removeIfAllowed(uploadedPath, uploadedPath, currentUserId)
  }
  if (confirmed !== null) {
    const old = oldAvatarToRemove(base, confirmed)
    if (old !== null) {
      forgetAvatarUrl(old)
      cleanup.old = await removeIfAllowed(old, base.avatarPath, currentUserId)
    }
  }

  return {
    db,
    profile: confirmed ?? reloaded,
    error,
    newFileKept: uploadedPath !== null && db === 'unknown',
    cleanup,
  }
}

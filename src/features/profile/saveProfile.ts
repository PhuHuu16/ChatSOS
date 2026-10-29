// Saves the profile dialog: uploads a new avatar first, then changes the name and the
// avatar with ONE compare-and-set update, then cleans up files. A file is removed only
// when the database is known not to use it, and only if it is either the file this save
// uploaded or the profile's previous avatar, inside the signed-in user's own folder.
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

// 'skipped': nothing was removed, because nothing needed to be or it was not safe to.
export type CleanupOutcome = RemoveOutcome | 'skipped'

export interface SaveProfileResult {
  // 'notAttempted': the update was never sent (wrong user, upload failed, no change).
  db: DbOutcome | 'notAttempted'
  // The profile as the database stores it: confirmed when db is 'saved', otherwise the
  // reloaded copy when there was one (db 'notSaved' or 'unknown'), else null.
  profile: OwnProfile | null
  error: ProfileSaveErrorKey | AvatarUploadErrorKey | null
  // True when a file was uploaded and kept because its use is not known.
  newFileKept: boolean
  cleanup: { old: CleanupOutcome; new: CleanupOutcome }
}

const NOTHING_REMOVED = { old: 'skipped', new: 'skipped' } as const

// Removes `path` only if it is exactly the allowed file and inside the user's own folder.
async function removeIfAllowed(
  path: string | null,
  allowed: string | null,
  currentUserId: string,
): Promise<CleanupOutcome> {
  if (path === null || allowed === null || path !== allowed) return 'skipped'
  if (!isOwnAvatarPath(path, currentUserId)) return 'skipped'
  return removeAvatarFile(path)
}

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

  // Removing an avatar when there is none changes nothing.
  const wantsRemove = avatar.kind === 'remove' && base.avatarPath !== null
  if (displayName === base.displayName && avatar.kind !== 'replace' && !wantsRemove) {
    return notAttempted(null)
  }

  // 1. Upload. The path is created here, so this save knows exactly which file it made.
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

  // 2. One compare-and-set update for both fields.
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
    // 'unknown' (no answer) or 'failed' (an error answer, which a proxy can also send after
    // the database already wrote the row, e.g. a gateway timeout): only the stored profile
    // can tell what happened.
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

  // 3. Clean up, each file separately.
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

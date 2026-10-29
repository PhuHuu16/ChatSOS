// Avatar object names in the avatars bucket: "<user id>/<uuid>.jpg", lowercase, exactly 77
// characters. Same rule as the upload policy and the profiles_validate_avatar trigger in
// supabase/migrations/20261029000100_avatars.sql. No imports, so it can be tested offline.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const AVATAR_PATH_PATTERN = new RegExp(`^${UUID}/${UUID}\\.jpg$`)
export const AVATAR_PATH_LENGTH = 77

// A new, never reused object name inside the user's own folder.
export function newAvatarPath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.jpg`
}

// True only for a well-formed avatar path inside `userId`'s own folder.
export function isOwnAvatarPath(path: string, userId: string): boolean {
  return (
    path.length === AVATAR_PATH_LENGTH &&
    AVATAR_PATH_PATTERN.test(path) &&
    path.split('/')[0] === userId
  )
}

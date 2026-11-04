const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const AVATAR_PATH_PATTERN = new RegExp(`^${UUID}/${UUID}\\.jpg$`)
export const AVATAR_PATH_LENGTH = 77

export function newAvatarPath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.jpg`
}

export function isOwnAvatarPath(path: string, userId: string): boolean {
  return (
    path.length === AVATAR_PATH_LENGTH &&
    AVATAR_PATH_PATTERN.test(path) &&
    path.split('/')[0] === userId
  )
}

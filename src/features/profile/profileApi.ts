// The signed-in user's own profile: loading it and saving changes to it.
import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'
import type { ChatResult } from '../chat/api'
import { toChatErrorKey } from '../chat/chatErrors'

export interface OwnProfile {
  id: string
  // Never changed by the app: the database does not let clients update it.
  username: string
  displayName: string
  // "<user id>/<uuid>.jpg" in the avatars bucket, or null when there is no avatar.
  avatarPath: string | null
}

type ProfileRow = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'username' | 'display_name' | 'avatar_path'
>

const PROFILE_COLUMNS = 'id, username, display_name, avatar_path'

function toOwnProfile(row: ProfileRow): OwnProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
  }
}

export async function fetchOwnProfile(userId: string): Promise<ChatResult<OwnProfile>> {
  const response = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()
  if (response.error) {
    return { ok: false, error: toChatErrorKey(response.status, response.error.code, 'load') }
  }
  if (!response.data) return { ok: false, error: 'chat.errors.loadFailed' }
  return { ok: true, data: toOwnProfile(response.data) }
}

// Only the fields to change; a missing field is left as it is.
export interface ProfileChange {
  displayName?: string
  avatarPath?: string | null
}

export type ProfileSaveErrorKey = 'profile.errors.saveFailed' | 'profile.errors.notAllowed'

export type ProfileSaveResult =
  // Saved; the profile as the database now stores it (returned by the update itself).
  | { status: 'saved'; profile: OwnProfile }
  // Not saved: the name or the avatar was changed elsewhere since `expected` was read.
  | { status: 'conflict' }
  // Not saved: the database refused or failed the update.
  | { status: 'failed'; error: ProfileSaveErrorKey }
  // No answer (e.g. the connection dropped): the update may or may not have happened.
  | { status: 'unknown' }

// One UPDATE that only applies when the stored name and avatar are still the ones the
// caller read (compare-and-set), so a change made in another tab is never overwritten.
export async function updateProfile(
  expected: OwnProfile,
  change: ProfileChange,
): Promise<ProfileSaveResult> {
  const values: Database['public']['Tables']['profiles']['Update'] = {}
  if (change.displayName !== undefined) values.display_name = change.displayName
  if (change.avatarPath !== undefined) values.avatar_path = change.avatarPath

  const filtered = supabase
    .from('profiles')
    .update(values)
    .eq('id', expected.id)
    .eq('display_name', expected.displayName)
  const response = await (
    expected.avatarPath === null
      ? filtered.is('avatar_path', null)
      : filtered.eq('avatar_path', expected.avatarPath)
  )
    .select(PROFILE_COLUMNS)
    .maybeSingle()

  if (response.error) {
    // postgrest-js reports "no HTTP response" as status 0.
    if (response.status === 0) return { status: 'unknown' }
    const key = toChatErrorKey(response.status, response.error.code, 'change')
    return {
      status: 'failed',
      error: key === 'chat.errors.notAllowed' ? 'profile.errors.notAllowed' : 'profile.errors.saveFailed',
    }
  }
  // RLS limits the update to the caller's own row, so no row means the compare failed.
  if (!response.data) return { status: 'conflict' }
  return { status: 'saved', profile: toOwnProfile(response.data) }
}

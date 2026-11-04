import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'
import type { ChatResult } from '../chat/api'
import { toChatErrorKey } from '../chat/chatErrors'

export interface OwnProfile {
  id: string
  username: string
  displayName: string
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

// Lấy hồ sơ
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

export interface ProfileChange {
  displayName?: string
  avatarPath?: string | null
}

export type ProfileSaveErrorKey = 'profile.errors.saveFailed' | 'profile.errors.notAllowed'

export type ProfileSaveResult =
  | { status: 'saved'; profile: OwnProfile }
  | { status: 'conflict' }
  | { status: 'failed'; error: ProfileSaveErrorKey }
  | { status: 'unknown' }

// Cập nhật hồ sơ
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
    if (response.status === 0) return { status: 'unknown' }
    const key = toChatErrorKey(response.status, response.error.code, 'change')
    return {
      status: 'failed',
      error: key === 'chat.errors.notAllowed' ? 'profile.errors.notAllowed' : 'profile.errors.saveFailed',
    }
  }
  if (!response.data) return { status: 'conflict' }
  return { status: 'saved', profile: toOwnProfile(response.data) }
}

export interface ProfileFields {
  displayName: string
  avatarPath: string | null
}

export type AvatarEdit = { kind: 'keep' } | { kind: 'replace'; path: string } | { kind: 'remove' }

export type DbOutcome = 'saved' | 'conflict' | 'failed' | 'notSaved' | 'unknown'

export function sameFields(a: ProfileFields, b: ProfileFields): boolean {
  return a.displayName === b.displayName && a.avatarPath === b.avatarPath
}

export function expectedFields(
  base: ProfileFields,
  displayName: string,
  avatar: AvatarEdit,
): ProfileFields {
  return {
    displayName,
    avatarPath:
      avatar.kind === 'replace' ? avatar.path : avatar.kind === 'remove' ? null : base.avatarPath,
  }
}

export function afterUnknown(
  base: ProfileFields,
  expected: ProfileFields,
  fresh: ProfileFields | null,
): 'saved' | 'notSaved' | 'unknown' {
  if (fresh === null) return 'unknown'
  if (sameFields(base, expected)) return 'unknown'
  if (sameFields(fresh, expected)) return 'saved'
  if (sameFields(fresh, base)) return 'notSaved'
  return 'unknown'
}

export function shouldRemoveNewFile(outcome: DbOutcome): boolean {
  return outcome === 'conflict' || outcome === 'failed' || outcome === 'notSaved'
}

export function oldAvatarToRemove(base: ProfileFields, stored: ProfileFields): string | null {
  if (base.avatarPath === null) return null
  if (stored.avatarPath === base.avatarPath) return null
  return base.avatarPath
}

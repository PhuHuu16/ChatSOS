// Pure decisions for saving a profile: what the database should store afterwards, how to
// read a profile reloaded after an unanswered save, and which file may be removed.
// No Supabase, no network, so every rule here can be tested offline.

// The two fields a profile save can change.
export interface ProfileFields {
  displayName: string
  avatarPath: string | null
}

export type AvatarEdit = { kind: 'keep' } | { kind: 'replace'; path: string } | { kind: 'remove' }

// What the database stores, as far as the app knows: confirmed saved by the update or a
// reload ('saved'), refused by the compare-and-set ('conflict'), refused with an error
// answer AND confirmed unchanged by a reload ('failed'), confirmed unchanged by a reload
// after no answer ('notSaved'), or not known ('unknown').
export type DbOutcome = 'saved' | 'conflict' | 'failed' | 'notSaved' | 'unknown'

export function sameFields(a: ProfileFields, b: ProfileFields): boolean {
  return a.displayName === b.displayName && a.avatarPath === b.avatarPath
}

// The fields the database should store once the save has happened.
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

// Reads the profile reloaded after a save that got no answer. Only a full match counts:
// both fields as expected means saved, both fields as before means not saved. Anything
// else (one field of each, a third value, or no reload) stays unknown.
export function afterUnknown(
  base: ProfileFields,
  expected: ProfileFields,
  fresh: ProfileFields | null,
): 'saved' | 'notSaved' | 'unknown' {
  if (fresh === null) return 'unknown'
  // A save that changes nothing cannot be told apart from one that did not happen.
  if (sameFields(base, expected)) return 'unknown'
  if (sameFields(fresh, expected)) return 'saved'
  if (sameFields(fresh, base)) return 'notSaved'
  return 'unknown'
}

// The file this save uploaded may be removed only when the database is known not to use
// it: the compare-and-set wrote nothing, or a reload showed the profile unchanged (after
// an error answer or no answer). An error or a missing answer alone is never enough.
export function shouldRemoveNewFile(outcome: DbOutcome): boolean {
  return outcome === 'conflict' || outcome === 'failed' || outcome === 'notSaved'
}

// The old avatar that may be removed once `stored` is CONFIRMED by the database (the
// update's own answer, or a reload that matched the expected fields): only the profile's
// previous avatar, and only when the stored profile no longer refers to it. A null stored
// path proves nothing when there was no avatar before.
export function oldAvatarToRemove(base: ProfileFields, stored: ProfileFields): string | null {
  if (base.avatarPath === null) return null
  if (stored.avatarPath === base.avatarPath) return null
  return base.avatarPath
}

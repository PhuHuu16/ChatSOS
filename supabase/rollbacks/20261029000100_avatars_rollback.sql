-- ChatSOS · rollback of migration 8 (20261029000100_avatars.sql).
-- Run by hand in the Supabase SQL Editor, only when Phase 9 must be undone.
-- Wrapped in a transaction: when a check fails, nothing is changed.
--
-- Before running it:
--   1. In the app, every user removes their avatar, so no profile has avatar_path set.
--      This script never clears avatar_path itself: it refuses instead.
--   2. In the Dashboard (Storage > avatars), delete every file in the bucket. Files can
--      only be removed through Storage, never by SQL, so this script does not try.
-- After it succeeds:
--   3. Delete the now empty "avatars" bucket in the Dashboard (Storage > avatars >
--      Delete bucket). Storage blocks deleting buckets by SQL, and this script does not
--      bypass that. An empty bucket without policies is unreachable for every user.
--
-- Limits: signed URLs issued earlier keep working until they expire. Afterwards
-- avatar_path is only checked by the original profiles_avatar_path_valid constraint.
-- Nothing of the attachments bucket, Realtime or user data is touched.

begin;

-- No profile can set avatar_path while this runs, so the check below stays true.
lock table public.profiles in share row exclusive mode;

do $$
declare
  v_profiles bigint;
  v_objects bigint;
begin
  select count(*) into v_profiles
  from public.profiles
  where avatar_path is not null;

  if v_profiles > 0 then
    raise exception 'rollback refused: % profile(s) still use an avatar', v_profiles
      using errcode = '55000',
            hint = 'Remove those avatars in the app first. This script never clears avatar_path.';
  end if;

  select count(*) into v_objects
  from storage.objects
  where bucket_id = 'avatars';

  if v_objects > 0 then
    raise exception 'rollback refused: bucket avatars still holds % file(s)', v_objects
      using errcode = '55000',
            hint = 'Delete them in the Dashboard (Storage > avatars) first.';
  end if;
end;
$$;

-- Reverse order of the migration. No IF EXISTS and no CASCADE: if anything differs from
-- what the migration created, the statement fails and the whole rollback is undone.
drop policy "avatars: owners delete unused files" on storage.objects;
drop policy "avatars: users upload to their own folder" on storage.objects;
drop policy "avatars: read avatars in use or own files" on storage.objects;

drop trigger profiles_validate_avatar on public.profiles;

drop function private.validate_profile_avatar();
drop function private.avatar_in_use(text);

drop index public.profiles_avatar_path_key;

do $$
begin
  raise notice 'avatars rollback done. Delete the empty "avatars" bucket in the Dashboard (Storage > avatars > Delete bucket).';
end;
$$;

commit;

begin;

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

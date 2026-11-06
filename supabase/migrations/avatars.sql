begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg']);

create unique index profiles_avatar_path_key on public.profiles (avatar_path);

create function private.avatar_in_use(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.avatar_path = p_object_name
  );
$$;

revoke all on function private.avatar_in_use(text) from public, anon;
grant execute on function private.avatar_in_use(text) to authenticated;

-- Ảnh đại diện
create function private.validate_profile_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_metadata jsonb;
  v_size bigint;
begin
  if new.avatar_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.avatar_path is not distinct from old.avatar_path then
      return new;
    end if;
  end if;

  if not (
    char_length(new.avatar_path) = 77
    and new.avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and split_part(new.avatar_path, '/', 1) = new.id::text
  ) then
    raise exception 'invalid avatar path' using errcode = '22023';
  end if;

  select o.owner_id, o.metadata
  into v_owner, v_metadata
  from storage.objects o
  where o.bucket_id = 'avatars'
    and o.name = new.avatar_path
    and coalesce(o.is_delete_marker, false) = false;

  if not found then
    raise exception 'avatar not uploaded' using errcode = '23503';
  end if;

  if v_owner is distinct from new.id::text then
    raise exception 'avatar was uploaded by another user' using errcode = '42501';
  end if;

  if v_metadata ->> 'mimetype' is distinct from 'image/jpeg' then
    raise exception 'avatar must be a JPEG image' using errcode = '22023';
  end if;

  if coalesce(v_metadata ->> 'size', '') ~ '^[0-9]{1,18}$' then
    v_size := (v_metadata ->> 'size')::bigint;
  end if;
  if v_size is null or v_size < 1 or v_size > 1048576 then
    raise exception 'avatar size is not valid' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_profile_avatar() from public, anon, authenticated;

create trigger profiles_validate_avatar
  before insert or update of avatar_path on public.profiles
  for each row execute function private.validate_profile_avatar();

create policy "avatars: read avatars in use or own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      private.avatar_in_use(name)
      or (
        owner_id = (select auth.uid())::text
        and split_part(name, '/', 1) = (select auth.uid())::text
      )
    )
  );

create policy "avatars: users upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and char_length(name) = 77
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

create policy "avatars: owners delete unused files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and owner_id = (select auth.uid())::text
    and split_part(name, '/', 1) = (select auth.uid())::text
    and not private.avatar_in_use(name)
  );

commit;

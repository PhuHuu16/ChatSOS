begin;

lock table public.profiles in share row exclusive mode;

do $$
declare
  v_phones bigint;
begin
  select count(*) into v_phones from public.profiles where phone is not null;
  if v_phones > 0 then
    raise exception 'rollback refused: % profile(s) still have a phone number', v_phones
      using errcode = '55000',
            hint = 'Run "update public.profiles set phone = null where phone is not null;" first if those numbers may be lost.';
  end if;
end;
$$;

drop view admin.users;
drop schema admin;

drop function public.find_profile_by_phone(text);
drop function public.hook_before_user_created(jsonb);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if v_username !~ '^[a-z0-9_]{3,32}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;

  if char_length(v_display_name) not between 1 and 64 or v_display_name ~ '[[:cntrl:]]' then
    raise exception 'invalid display name' using errcode = '22023';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop function private.normalize_vn_phone(text);

alter table public.profiles drop constraint profiles_phone_key;
alter table public.profiles drop column phone;

comment on table public.profiles is
  'Public profile of each auth user. Holds no email or other private data.';

commit;

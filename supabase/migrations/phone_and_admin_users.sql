begin;

alter table public.profiles
  add column phone text
    constraint profiles_phone_format check (phone is null or phone ~ '^\+84[35789][0-9]{8}$');

alter table public.profiles
  add constraint profiles_phone_key unique (phone);

comment on table public.profiles is
  'Profile of each auth user. Clients can read only id, username, display_name and '
  'avatar_path; phone has no client grant.';

-- Chuẩn hóa số điện thoại
create function private.normalize_vn_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when s.v ~ '^0[35789][0-9]{8}$' then '+84' || substr(s.v, 2)
    when s.v ~ '^84[35789][0-9]{8}$' then '+' || s.v
    when s.v ~ '^\+84[35789][0-9]{8}$' then s.v
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[[:space:].()-]', '', 'g') as v) as s;
$$;

revoke all on function private.normalize_vn_phone(text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  v_phone text := private.normalize_vn_phone(new.raw_user_meta_data ->> 'phone');
begin
  if v_username !~ '^[a-z0-9_]{3,32}$' then
    raise exception 'invalid username' using errcode = '22023';
  end if;

  if char_length(v_display_name) not between 1 and 64 or v_display_name ~ '[[:cntrl:]]' then
    raise exception 'invalid display name' using errcode = '22023';
  end if;

  if v_phone is null then
    raise exception 'invalid phone' using errcode = '22023';
  end if;

  insert into public.profiles (id, username, display_name, phone)
  values (new.id, v_username, v_display_name, v_phone);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Kiểm tra trước khi tạo tài khoản
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := event -> 'user' -> 'user_metadata';
  v_username text;
  v_phone text;
begin
  if jsonb_typeof(v_meta) is distinct from 'object'
     or (v_meta -> 'username' is null and v_meta -> 'phone' is null) then
    return '{}'::jsonb;
  end if;

  v_username := lower(btrim(coalesce(v_meta ->> 'username', '')));
  v_phone := private.normalize_vn_phone(v_meta ->> 'phone');

  if v_username !~ '^[a-z0-9_]{3,32}$' then
    return jsonb_build_object('error',
      jsonb_build_object('http_code', 400, 'message', 'chatsos:username_invalid'));
  end if;

  if v_phone is null then
    return jsonb_build_object('error',
      jsonb_build_object('http_code', 400, 'message', 'chatsos:phone_invalid'));
  end if;

  if exists (select 1 from public.profiles p where p.username = v_username) then
    return jsonb_build_object('error',
      jsonb_build_object('http_code', 409, 'message', 'chatsos:username_taken'));
  end if;

  if exists (select 1 from public.profiles p where p.phone = v_phone) then
    return jsonb_build_object('error',
      jsonb_build_object('http_code', 409, 'message', 'chatsos:phone_taken'));
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- Tìm theo số điện thoại
create function public.find_profile_by_phone(p_phone text)
returns table (id uuid, username text, display_name text, avatar_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_phone text := private.normalize_vn_phone(p_phone);
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if v_phone is null then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_path
    from public.profiles p
    where p.phone = v_phone
      and p.id <> v_me;
end;
$$;

revoke all on function public.find_profile_by_phone(text) from public, anon;
grant execute on function public.find_profile_by_phone(text) to authenticated;

create schema admin;
revoke all on schema admin from public, anon, authenticated;

-- Danh sách người dùng cho admin
create view admin.users
with (security_invoker = true)
as
select
  u.id,
  u.email,
  p.phone,
  p.username,
  p.display_name,
  p.avatar_path,
  u.created_at,
  u.last_sign_in_at,
  u.email_confirmed_at,
  u.banned_until,
  (select count(*) from public.conversation_members m where m.user_id = u.id) as conversations,
  (select count(*) from public.messages x where x.sender_id = u.id) as messages_sent
from auth.users u
left join public.profiles p on p.id = u.id;

revoke all on table admin.users from public, anon, authenticated;

comment on view admin.users is
  'ChatSOS accounts with profile and activity. Dashboard only; contains no password data.';

commit;

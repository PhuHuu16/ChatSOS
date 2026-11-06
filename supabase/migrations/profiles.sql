begin;

-- Bảng hồ sơ người dùng
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null
    constraint profiles_display_name_valid check (
      char_length(display_name) <= 64
      and char_length(btrim(display_name)) >= 1
      and display_name !~ '[[:cntrl:]]'
    ),
  avatar_path text
    constraint profiles_avatar_path_valid check (
      avatar_path is null
      or (char_length(avatar_path) <= 255 and split_part(avatar_path, '/', 1) = id::text)
    ),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile of each auth user. Holds no email or other private data.';

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;

grant select (id, username, display_name, avatar_path) on table public.profiles to authenticated;
grant update (display_name, avatar_path) on table public.profiles to authenticated;

create policy "profiles: signed-in users can read"
  on public.profiles for select to authenticated
  using (true);

create policy "profiles: users update their own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Tạo hồ sơ khi đăng ký
create function public.handle_new_user()
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;

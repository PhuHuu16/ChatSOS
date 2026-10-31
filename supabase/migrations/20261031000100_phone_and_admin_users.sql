-- ChatSOS · Phase 11 · migration 10: phone numbers and a user overview for admins.
-- Run after 20261030000100_delete_messages_and_conversations.sql. Wrapped in a transaction.
--
-- 1. profiles.phone: a Vietnamese mobile number, stored as +84xxxxxxxxx, one account per
--    number. Existing accounts keep null; new sign-ups must give one. Clients cannot read
--    the column (no grant), so numbers are never listed or shown to other users.
-- 2. handle_new_user also stores the phone from the sign-up data.
-- 3. hook_before_user_created: an Auth hook (enable it in Dashboard > Authentication >
--    Hooks > Before User Created) that rejects a taken or invalid username or phone with a
--    clear error before the account is created. Without it the same sign-ups still fail
--    in handle_new_user, but only with a generic HTTP 500.
-- 4. find_profile_by_phone: signed-in users find someone by their exact number. The
--    number itself is never returned.
-- 5. admin.users: every account with its profile and activity, for the Dashboard only
--    (Table Editor > schema "admin"). No password data. Not reachable through the API.

begin;

-- 1. Phone column ---------------------------------------------------------------------

alter table public.profiles
  add column phone text
    constraint profiles_phone_format check (phone is null or phone ~ '^\+84[35789][0-9]{8}$');

alter table public.profiles
  add constraint profiles_phone_key unique (phone);

comment on table public.profiles is
  'Profile of each auth user. Clients can read only id, username, display_name and '
  'avatar_path; phone has no client grant.';

-- Turns what a user typed into the stored form, or null when it is not a Vietnamese
-- mobile number. Accepts 0912345678, 84912345678 and +84912345678, with spaces, dots,
-- dashes or parentheses anywhere. Mirrored by normalizePhone in src/features/auth/validation.ts.
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

-- Only the SECURITY DEFINER functions below (owned by postgres) call it.
revoke all on function private.normalize_vn_phone(text) from public, anon, authenticated;

-- 2. Sign-up stores the phone -----------------------------------------------------------

-- Same as migration 1, plus the phone. Missing or invalid data still aborts the sign-up.
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

-- 3. Before User Created hook -------------------------------------------------------------

-- Called by Supabase Auth (role supabase_auth_admin) before it inserts the user. Returns
-- {} to allow, or an error whose message the app maps to a translated text (these
-- messages are the app's contract; keep them in sync with src/features/auth/authErrors.ts).
-- A request without ChatSOS sign-up data is allowed here and rejected by handle_new_user.
-- A race between two identical sign-ups is still caught by the unique constraints.
-- In public so the Dashboard hook picker lists it; no client role can execute it.
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

-- 4. Find someone by phone ------------------------------------------------------------------

-- Exact match only, never the caller, and without the number in the result. An invalid
-- number gives no rows (the app validates before calling).
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

-- 5. User overview for admins ---------------------------------------------------------------

-- Not in Settings > Data API > Exposed schemas, and no client role has any right on it.
create schema admin;
revoke all on schema admin from public, anon, authenticated;

-- security_invoker: whoever reads the view needs rights on auth.users and public.*
-- themselves (postgres in the Dashboard has them), so a stray grant on the view alone
-- would not expose anything. Never selects encrypted_password or any token column.
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
